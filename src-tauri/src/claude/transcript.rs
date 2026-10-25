//! Incremental reader for Claude Code transcripts (`~/.claude/projects/*/<session>.jsonl`).
//!
//! Observed format: one JSON object per line. `assistant` lines carry
//! `message.{id, model, usage, content}`; a response split into several content
//! blocks repeats the same `message.id` and usage, so usage is keyed by id.
//! Subagent lines are marked `isSidechain` and do not count toward context.

use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use super::pricing::{self, Tokens};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub content: String,
    pub status: String,
    pub active_form: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSummary {
    pub model: Option<String>,
    pub title: Option<String>,
    /// Tokens sent with the latest main-thread request (input + cache).
    pub context_tokens: u64,
    pub totals: TokenTotals,
    pub cost_usd: f64,
    pub prompts: u32,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
    pub first_prompt: Option<String>,
    pub todos: Vec<Todo>,
    pub files: BTreeSet<String>,
    /// (timestamp ms, context tokens) per response, for the context graph.
    pub timeline: Vec<(i64, u64)>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct Row {
    tokens: Tokens,
    cost: f64,
}

pub struct TranscriptReader {
    pub path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    rows: HashMap<String, Row>,
    pub summary: TranscriptSummary,
}

const MAX_TIMELINE: usize = 2000;
const EDIT_TOOLS: &[&str] = &["Edit", "Write", "MultiEdit", "NotebookEdit"];

impl TranscriptReader {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            offset: 0,
            partial: Vec::new(),
            rows: HashMap::new(),
            summary: TranscriptSummary::default(),
        }
    }

    /// Reads appended bytes; returns true when anything changed.
    pub fn poll(&mut self) -> bool {
        let Ok(mut f) = File::open(&self.path) else {
            return false;
        };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            // Rewritten file: start over.
            *self = Self::new(self.path.clone());
        }
        if len == self.offset {
            return false;
        }
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return false;
        }
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        if f.read_to_end(&mut buf).is_err() {
            return false;
        }
        self.offset += buf.len() as u64;
        self.feed(&buf);
        true
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.partial.extend_from_slice(bytes);
        let Some(last_nl) = self.partial.iter().rposition(|&b| b == b'\n') else {
            return;
        };
        let rest = self.partial.split_off(last_nl + 1);
        let complete = std::mem::replace(&mut self.partial, rest);
        for line in complete.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                self.line(&v);
            }
        }
    }

    fn line(&mut self, v: &Value) {
        let s = &mut self.summary;
        if let Some(ts) = v["timestamp"].as_str() {
            if s.first_ts.is_none() {
                s.first_ts = Some(ts.to_owned());
            }
            s.last_ts = Some(ts.to_owned());
        }
        let sidechain = v["isSidechain"].as_bool().unwrap_or(false);
        match v["type"].as_str() {
            Some("assistant") if !sidechain => self.assistant(v),
            Some("user") if !sidechain && !v["isMeta"].as_bool().unwrap_or(false) => {
                if let Some(text) = prompt_text(&v["message"]["content"]) {
                    s.prompts += 1;
                    if s.first_prompt.is_none() {
                        s.first_prompt = Some(text.chars().take(200).collect());
                    }
                }
            }
            Some("ai-title") => {
                if let Some(t) = v["aiTitle"].as_str() {
                    s.title = Some(t.to_owned());
                }
            }
            Some("custom-title") => {
                if let Some(t) = v["customTitle"].as_str() {
                    s.title = Some(t.to_owned());
                }
            }
            _ => {}
        }
    }

    fn assistant(&mut self, v: &Value) {
        let msg = &v["message"];
        let model = msg["model"].as_str().filter(|m| !m.starts_with('<'));
        if let Some(m) = model {
            self.summary.model = Some(m.to_owned());
        }
        if let Some(blocks) = msg["content"].as_array() {
            for b in blocks.iter().filter(|b| b["type"] == "tool_use") {
                let name = b["name"].as_str().unwrap_or("");
                let input = &b["input"];
                if name == "TodoWrite"
                    && let Some(todos) = input["todos"].as_array()
                {
                    self.summary.todos = todos
                        .iter()
                        .filter_map(|t| {
                            Some(Todo {
                                content: t["content"].as_str()?.to_owned(),
                                status: t["status"].as_str().unwrap_or("pending").to_owned(),
                                active_form: t["activeForm"].as_str().map(str::to_owned),
                            })
                        })
                        .collect();
                } else if EDIT_TOOLS.contains(&name)
                    && let Some(p) = input["file_path"]
                        .as_str()
                        .or(input["notebook_path"].as_str())
                {
                    self.summary.files.insert(p.to_owned());
                }
            }
        }
        let u = &msg["usage"];
        if !u.is_object() {
            return;
        }
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let write_total = n("cache_creation_input_tokens");
        let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"]
            .as_u64()
            .unwrap_or(0);
        let tokens = Tokens {
            input: n("input_tokens"),
            output: n("output_tokens"),
            cache_read: n("cache_read_input_tokens"),
            cache_write_5m: write_total.saturating_sub(write_1h),
            cache_write_1h: write_1h.min(write_total),
        };
        let model = model
            .map(str::to_owned)
            .or_else(|| self.summary.model.clone())
            .unwrap_or_default();
        let row = Row {
            cost: pricing::cost(&model, &tokens),
            tokens,
        };
        let id = msg["id"]
            .as_str()
            .or(v["requestId"].as_str())
            .or(v["uuid"].as_str())
            .unwrap_or("")
            .to_owned();
        let previous = self.rows.insert(id.clone(), row);
        let t = &mut self.summary.totals;
        if let Some(p) = previous {
            t.input -= p.tokens.input;
            t.output -= p.tokens.output;
            t.cache_read -= p.tokens.cache_read;
            t.cache_write -= p.tokens.cache_write_5m + p.tokens.cache_write_1h;
            self.summary.cost_usd -= p.cost;
        }
        t.input += tokens.input;
        t.output += tokens.output;
        t.cache_read += tokens.cache_read;
        t.cache_write += tokens.cache_write_5m + tokens.cache_write_1h;
        self.summary.cost_usd += row.cost;
        let context =
            tokens.input + tokens.cache_read + tokens.cache_write_5m + tokens.cache_write_1h;
        self.summary.context_tokens = context;
        if previous.is_none() {
            let ts = v["timestamp"].as_str().and_then(parse_ts).unwrap_or(0);
            let tl = &mut self.summary.timeline;
            tl.push((ts, context));
            if tl.len() > MAX_TIMELINE {
                tl.drain(..tl.len() - MAX_TIMELINE);
            }
        }
    }
}

/// A real typed prompt: plain text, not a tool result, slash-command echo or reminder.
fn prompt_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            if blocks.iter().any(|b| b["type"] == "tool_result") {
                return None;
            }
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => return None,
    };
    let t = text.trim();
    if t.is_empty()
        || t.starts_with("<command-")
        || t.starts_with("<local-command")
        || t.starts_with("<system-reminder>")
    {
        return None;
    }
    Some(t.to_owned())
}

/// RFC 3339 (`2026-10-25T23:39:45.075Z`) → epoch milliseconds, UTC only.
pub fn parse_ts(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = if b.get(19) == Some(&b'.') {
        let frac: String = s[20..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .take(3)
            .collect();
        format!("{frac:0<3}").parse::<i64>().ok()?
    } else {
        0
    };
    // Days from civil (Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + sec * 1000 + ms)
}

/// `~/.claude/projects/<cwd with non-alphanumerics replaced by '-'>`
pub fn project_dir(claude_home: &Path, cwd: &str) -> PathBuf {
    let encoded: String = cwd
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    claude_home.join("projects").join(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("fixtures/session.jsonl");

    fn read(text: &str) -> TranscriptReader {
        let mut r = TranscriptReader::new("/dev/null");
        r.feed(text.as_bytes());
        r
    }

    #[test]
    fn summary() {
        let r = read(FIXTURE);
        let s = &r.summary;
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.title.as_deref(), Some("Fix login bug"));
        assert_eq!(s.prompts, 2);
        assert_eq!(s.first_prompt.as_deref(), Some("fix the login bug"));
        // Last main-thread response: 10 + 50_000 + 2_000; the sidechain is ignored.
        assert_eq!(s.context_tokens, 52_010);
        // msg_1 counted once despite two content-block lines.
        assert_eq!(s.totals.output, 300 + 500);
        assert_eq!(s.totals.cache_write, 40_000 + 2_000);
        assert_eq!(s.timeline.len(), 2);
        assert_eq!(s.todos.len(), 2);
        assert_eq!(s.todos[0].status, "completed");
        assert!(s.files.contains("/repo/src/login.ts"));
        assert!(s.cost_usd > 0.0);
    }

    #[test]
    fn incremental_matches_whole() {
        let whole = read(FIXTURE);
        let mut r = TranscriptReader::new("/dev/null");
        for chunk in FIXTURE.as_bytes().chunks(37) {
            r.feed(chunk);
        }
        assert_eq!(r.summary.totals, whole.summary.totals);
        assert_eq!(r.summary.prompts, whole.summary.prompts);
        assert!((r.summary.cost_usd - whole.summary.cost_usd).abs() < 1e-12);
    }

    #[test]
    fn timestamps() {
        assert_eq!(parse_ts("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(
            parse_ts("2026-10-25T23:39:45.075Z"),
            Some(1_792_971_585_075)
        );
    }

    #[test]
    fn project_dirs() {
        let p = project_dir(Path::new("/h/.claude"), "/Users/me/Dev/my.app");
        assert_eq!(p, Path::new("/h/.claude/projects/-Users-me-Dev-my-app"));
    }
}
