//! One-shot AI requests for the terminal (command from text, explain, summarize, chat).
//! Default: `claude -p`, which reuses the user's Claude Code login. Optional: an
//! Anthropic API key kept in the macOS keychain.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::ipc::Channel;

const KEYCHAIN_SERVICE: &str = "app.nacre.terminal";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub system: String,
    pub prompt: String,
    /// Alias (`haiku`, `sonnet`, `opus`, `fable`) or a full model id.
    pub model: String,
    pub provider: String,
    pub cwd: Option<String>,
    pub claude_path: Option<String>,
    /// Earlier turns for chat: `[{"role": "user"|"assistant", "text": "..."}]`.
    #[serde(default)]
    pub history: Vec<Value>,
}

#[derive(Default, Clone)]
pub struct AiRuns {
    children: Arc<Mutex<HashMap<String, Child>>>,
    cancelled: Arc<Mutex<HashMap<String, bool>>>,
}

fn send(ch: &Channel<Value>, v: Value) {
    let _ = ch.send(v);
}

/// Finds `claude`: explicit path, the login shell's PATH, then common install dirs.
pub fn claude_binary(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = explicit.filter(|p| !p.trim().is_empty()) {
        return Some(PathBuf::from(p));
    }
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            let shell = crate::pty::env::default_shell();
            let from_shell = Command::new(&shell)
                .args(["-l", "-c", "command -v claude"])
                .stdin(Stdio::null())
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_owned())
                .filter(|s| s.starts_with('/'))
                .map(PathBuf::from);
            from_shell.or_else(|| {
                let home = std::env::var("HOME").unwrap_or_default();
                [
                    format!("{home}/.local/bin/claude"),
                    format!("{home}/.claude/local/claude"),
                    "/opt/homebrew/bin/claude".into(),
                    "/usr/local/bin/claude".into(),
                ]
                .into_iter()
                .map(PathBuf::from)
                .find(|p| p.exists())
            })
        })
        .clone()
}

pub fn model_id(alias: &str) -> String {
    match alias {
        "haiku" => "claude-haiku-5-5",
        "sonnet" => "claude-sonnet-5-5",
        "opus" => "claude-opus-5-5",
        "fable" => "claude-fable-5-1",
        other => other,
    }
    .to_owned()
}

/// The prompt with earlier chat turns inlined (for `claude -p`, which takes one message).
fn flatten(req: &AiRequest) -> String {
    if req.history.is_empty() {
        return req.prompt.clone();
    }
    let mut out = String::from("Conversation so far:\n");
    for turn in &req.history {
        let who = if turn["role"] == "assistant" {
            "Assistant"
        } else {
            "User"
        };
        out.push_str(&format!(
            "\n{who}: {}\n",
            turn["text"].as_str().unwrap_or("")
        ));
    }
    out.push_str(&format!("\nUser: {}", req.prompt));
    out
}

impl AiRuns {
    pub fn cancel(&self, id: &str) {
        self.cancelled.lock().unwrap().insert(id.to_owned(), true);
        if let Some(mut c) = self.children.lock().unwrap().remove(id) {
            let _ = c.kill();
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled
            .lock()
            .unwrap()
            .get(id)
            .copied()
            .unwrap_or(false)
    }

    pub fn run(&self, id: String, req: AiRequest, ch: Channel<Value>) {
        let runs = self.clone();
        thread::spawn(move || {
            let result = if req.provider == "api" {
                runs.run_api(&id, &req, &ch)
            } else {
                runs.run_claude(&id, &req, &ch)
            };
            match result {
                Ok(text) => send(&ch, json!({ "type": "done", "text": text })),
                Err(e) if runs.is_cancelled(&id) => {
                    let _ = e;
                    send(&ch, json!({ "type": "cancelled" }))
                }
                Err(e) => send(&ch, json!({ "type": "error", "message": e })),
            }
            runs.children.lock().unwrap().remove(&id);
            runs.cancelled.lock().unwrap().remove(&id);
        });
    }

    fn run_claude(&self, id: &str, req: &AiRequest, ch: &Channel<Value>) -> Result<String, String> {
        let bin = claude_binary(req.claude_path.as_deref())
            .ok_or("Claude Code not found. Install it or set ai.claude_path.")?;
        let mut cmd = Command::new(bin);
        cmd.args([
            "-p",
            "--model",
            &req.model,
            "--tools",
            "",
            "--no-session-persistence",
            "--system-prompt",
            &req.system,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Our own hooks must not count this as a Nacre session.
        .env_remove("NACRE_SOCKET")
        .env_remove("NACRE_PANE_ID");
        if let Some(cwd) = req
            .cwd
            .as_deref()
            .filter(|c| std::path::Path::new(c).is_dir())
        {
            cmd.current_dir(cwd);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Cannot start Claude Code: {e}"))?;
        // The prompt goes through stdin: no length limit, not visible in `ps`.
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(flatten(req).as_bytes());
        }
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let mut stderr = child.stderr.take().ok_or("no stderr")?;
        self.children.lock().unwrap().insert(id.to_owned(), child);
        let mut text = String::new();
        let mut final_text: Option<String> = None;
        let mut error: Option<String> = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match v["type"].as_str() {
                Some("stream_event") => {
                    let ev = &v["event"];
                    if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                        let t = ev["delta"]["text"].as_str().unwrap_or("");
                        text.push_str(t);
                        send(ch, json!({ "type": "delta", "text": t }));
                    }
                }
                Some("result") => {
                    if v["is_error"].as_bool() == Some(true) {
                        error = Some(
                            v["result"]
                                .as_str()
                                .unwrap_or("Claude Code failed.")
                                .to_owned(),
                        );
                    } else {
                        final_text = v["result"].as_str().map(str::to_owned);
                    }
                }
                _ => {}
            }
        }
        let status = self
            .children
            .lock()
            .unwrap()
            .remove(id)
            .and_then(|mut c| c.wait().ok());
        if let Some(e) = error {
            return Err(e);
        }
        if let Some(t) = final_text {
            return Ok(t);
        }
        if status.is_some_and(|s| !s.success()) || text.is_empty() {
            let mut err = String::new();
            let _ = stderr.read_to_string(&mut err);
            let line = err
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("Claude Code stopped.");
            return Err(line.to_owned());
        }
        Ok(text)
    }

    fn run_api(&self, id: &str, req: &AiRequest, ch: &Channel<Value>) -> Result<String, String> {
        let key =
            api_key().ok_or("No API key. Add one in Settings → Claude, or use Claude Code.")?;
        let model = model_id(&req.model);
        let mut messages: Vec<Value> = req
            .history
            .iter()
            .map(|t| {
                json!({
                    "role": if t["role"] == "assistant" { "assistant" } else { "user" },
                    "content": t["text"].as_str().unwrap_or(""),
                })
            })
            .collect();
        messages.push(json!({ "role": "user", "content": req.prompt }));
        let mut body = json!({
            "model": model,
            "max_tokens": 4096,
            "stream": true,
            "system": req.system,
            "messages": messages,
            "output_config": { "effort": "low" },
        });
        let mut builder = reqwest::blocking::Client::new()
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");
        // Refusal fallbacks where the API offers them (not on Haiku).
        if !model.contains("haiku") {
            body["fallbacks"] = json!("default");
            builder = builder.header("anthropic-beta", "server-side-fallback-2026-07-01");
        }
        let resp = builder
            .body(body.to_string())
            .send()
            .map_err(|e| format!("Network error: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let msg = resp
                .json::<Value>()
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
                .unwrap_or_default();
            return Err(format!("API error {status}: {msg}"));
        }
        let mut text = String::new();
        let mut stop = String::new();
        for line in BufReader::new(resp).lines().map_while(Result::ok) {
            if self.is_cancelled(id) {
                return Err("cancelled".into());
            }
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            match v["type"].as_str() {
                Some("content_block_delta") if v["delta"]["type"] == "text_delta" => {
                    let t = v["delta"]["text"].as_str().unwrap_or("");
                    text.push_str(t);
                    send(ch, json!({ "type": "delta", "text": t }));
                }
                Some("message_delta") => {
                    stop = v["delta"]["stop_reason"].as_str().unwrap_or("").to_owned();
                }
                Some("error") => {
                    return Err(v["error"]["message"]
                        .as_str()
                        .unwrap_or("API error")
                        .to_owned());
                }
                _ => {}
            }
        }
        if stop == "refusal" {
            return Err("The model declined this request.".into());
        }
        Ok(text)
    }
}

#[cfg(target_os = "macos")]
pub fn api_key() -> Option<String> {
    security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .filter(|k| !k.is_empty())
}

#[cfg(target_os = "macos")]
pub fn set_api_key(key: Option<&str>) -> Result<(), String> {
    use security_framework::passwords::{delete_generic_password, set_generic_password};
    match key.filter(|k| !k.trim().is_empty()) {
        Some(k) => set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, k.trim().as_bytes())
            .map_err(|e| e.to_string()),
        None => {
            let _ = delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
            Ok(())
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn api_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok()
}

#[cfg(not(target_os = "macos"))]
pub fn set_api_key(_key: Option<&str>) -> Result<(), String> {
    Err("Use the ANTHROPIC_API_KEY environment variable on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases() {
        assert_eq!(model_id("haiku"), "claude-haiku-5-5");
        assert_eq!(model_id("claude-opus-4-8"), "claude-opus-4-8");
    }

    #[test]
    fn flattens_history() {
        let req = AiRequest {
            system: String::new(),
            prompt: "and now?".into(),
            model: "haiku".into(),
            provider: "claude-code".into(),
            cwd: None,
            claude_path: None,
            history: vec![
                json!({"role": "user", "text": "hi"}),
                json!({"role": "assistant", "text": "hello"}),
            ],
        };
        let f = flatten(&req);
        assert!(
            f.contains("User: hi")
                && f.contains("Assistant: hello")
                && f.ends_with("User: and now?")
        );
    }
}
