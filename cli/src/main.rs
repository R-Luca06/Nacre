//! `nacre`: drive Nacre from scripts and Claude Code hooks.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::Duration;

use serde_json::{Value, json};

const HELP: &str = "nacre — control Nacre from the shell

  nacre new-tab [--cwd DIR] [--cmd CMD]
  nacre split [right|down] [--cwd DIR] [--cmd CMD]
  nacre send-text [--pane ID] [--enter] TEXT
  nacre notify TITLE [BODY]
  nacre claude-event              (Claude Code hook, reads JSON on stdin)
  nacre statusline [--wrap CMD]   (Claude Code status line)
  nacre ping
";

unsafe extern "C" {
    fn getuid() -> u32;
}

fn socket_path() -> PathBuf {
    if let Some(p) = std::env::var_os("NACRE_SOCKET").filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    let uid = unsafe { getuid() };
    std::env::temp_dir().join(format!("nacre-{uid}.sock"))
}

fn request(req: &Value, timeout: Duration) -> Result<Value, String> {
    let path = socket_path();
    let mut s = UnixStream::connect(&path).map_err(|_| "Nacre is not running.".to_string())?;
    s.set_read_timeout(Some(timeout)).ok();
    s.set_write_timeout(Some(timeout)).ok();
    writeln!(s, "{req}").map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&s)
        .read_line(&mut line)
        .map_err(|_| "No answer from Nacre.".to_string())?;
    let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if v["ok"].as_bool() == Some(true) {
        Ok(v["data"].clone())
    } else {
        Err(v["error"].as_str().unwrap_or("Request failed.").to_string())
    }
}

fn pane() -> Value {
    std::env::var("NACRE_PANE_ID").map_or(Value::Null, Value::String)
}

fn read_stdin() -> String {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    s
}

/// Hook entry point: silent, always succeeds, never delays Claude more than a second.
fn claude_event() -> ExitCode {
    let input = read_stdin();
    if std::env::var_os("NACRE_SOCKET").is_none() {
        return ExitCode::SUCCESS;
    }
    if let Ok(payload) = serde_json::from_str::<Value>(&input) {
        let req = json!({ "cmd": "claude.event", "pane": pane(), "payload": payload });
        let _ = request(&req, Duration::from_secs(1));
    }
    ExitCode::SUCCESS
}

fn statusline(wrap: Option<String>) -> ExitCode {
    let input = read_stdin();
    let payload: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    if std::env::var_os("NACRE_SOCKET").is_some() && payload.is_object() {
        let req = json!({ "cmd": "claude.statusline", "pane": pane(), "payload": payload });
        let _ = request(&req, Duration::from_millis(300));
    }
    if let Some(cmd) = wrap {
        let child = Command::new("/bin/sh")
            .args(["-c", &cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn();
        return match child {
            Ok(mut c) => {
                if let Some(mut stdin) = c.stdin.take() {
                    let _ = stdin.write_all(input.as_bytes());
                }
                let code = c.wait().ok().and_then(|s| s.code()).unwrap_or(1);
                ExitCode::from(code as u8)
            }
            Err(_) => ExitCode::FAILURE,
        };
    }
    println!("{}", default_line(&payload));
    ExitCode::SUCCESS
}

fn default_line(p: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(m) = p["model"]["display_name"].as_str() {
        parts.push(m.to_string());
    }
    if let Some(pct) = p["context_window"]["used_percentage"].as_f64() {
        parts.push(format!("{}%", pct.round()));
    }
    if let Some(c) = p["cost"]["total_cost_usd"].as_f64() {
        parts.push(format!("${c:.2}"));
    }
    parts.join(" · ")
}

struct Args {
    flags: Vec<(String, Option<String>)>,
    positional: Vec<String>,
}

fn parse(args: &[String], with_value: &[&str]) -> Args {
    let mut flags = Vec::new();
    let mut positional = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if let Some(name) = a.strip_prefix("--") {
            let v = if with_value.contains(&name) {
                it.next().cloned()
            } else {
                None
            };
            flags.push((name.to_string(), v));
        } else {
            positional.push(a.clone());
        }
    }
    Args { flags, positional }
}

impl Args {
    fn get(&self, name: &str) -> Option<String> {
        self.flags
            .iter()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.clone())
    }
    fn has(&self, name: &str) -> bool {
        self.flags.iter().any(|(n, _)| n == name)
    }
}

fn send(req: Value) -> ExitCode {
    match request(&req, Duration::from_secs(5)) {
        Ok(data) => {
            if !data.is_null() {
                println!(
                    "{}",
                    data.as_str()
                        .map_or_else(|| data.to_string(), str::to_owned)
                );
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("nacre: {e}");
            ExitCode::FAILURE
        }
    }
}

fn cwd() -> Option<String> {
    std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some((cmd, rest)) = argv.split_first() else {
        print!("{HELP}");
        return ExitCode::SUCCESS;
    };
    match cmd.as_str() {
        "claude-event" => claude_event(),
        "statusline" => statusline(parse(rest, &["wrap"]).get("wrap")),
        "new-tab" => {
            let a = parse(rest, &["cwd", "cmd"]);
            send(json!({
                "cmd": "new-tab",
                "pane": pane(),
                "cwd": a.get("cwd").or_else(cwd),
                "command": a.get("cmd"),
            }))
        }
        "split" => {
            let a = parse(rest, &["cwd", "cmd"]);
            let side = a.positional.first().map_or("right", String::as_str);
            if side != "right" && side != "down" {
                eprintln!("nacre: split takes right or down");
                return ExitCode::FAILURE;
            }
            send(json!({
                "cmd": "split",
                "pane": pane(),
                "side": side,
                "cwd": a.get("cwd").or_else(cwd),
                "command": a.get("cmd"),
            }))
        }
        "send-text" => {
            let a = parse(rest, &["pane"]);
            let mut text = a.positional.join(" ");
            if a.has("enter") {
                text.push('\r');
            }
            let target = a.get("pane").map_or_else(pane, Value::String);
            send(json!({ "cmd": "send-text", "pane": target, "text": text }))
        }
        "notify" => {
            let title = rest.first().cloned().unwrap_or_else(|| "Nacre".into());
            let body = rest.get(1).cloned().unwrap_or_default();
            send(json!({ "cmd": "notify", "pane": pane(), "title": title, "body": body }))
        }
        "ping" => send(json!({ "cmd": "ping" })),
        "raw" => match rest.first().map(|r| serde_json::from_str::<Value>(r)) {
            Some(Ok(v)) => send(v),
            _ => {
                eprintln!("nacre: raw takes a JSON request");
                ExitCode::FAILURE
            }
        },
        "version" | "--version" | "-V" => {
            println!("nacre {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        "help" | "--help" | "-h" => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("nacre: unknown command \"{other}\". Run `nacre help`.");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args() {
        let a = parse(
            &["down".into(), "--cwd".into(), "/x".into(), "--enter".into()],
            &["cwd"],
        );
        assert_eq!(a.positional, vec!["down"]);
        assert_eq!(a.get("cwd").as_deref(), Some("/x"));
        assert!(a.has("enter"));
    }

    #[test]
    fn line() {
        let p = json!({"model":{"display_name":"Opus"},"context_window":{"used_percentage":61.6},"cost":{"total_cost_usd":1.234}});
        assert_eq!(default_line(&p), "Opus · 62% · $1.23");
    }
}
