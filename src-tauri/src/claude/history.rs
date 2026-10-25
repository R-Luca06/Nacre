//! Past sessions per project, and usage statistics across all transcripts.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

use super::pricing::{self, Tokens};
use super::transcript::{self, parse_ts};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastSession {
    pub id: String,
    pub path: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    pub modified: i64,
    pub prompts: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    pub day: String,
    pub project: String,
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost_usd: f64,
}

type Key = (PathBuf, SystemTime, u64);
/// path → (modified, size, value)
type Cache<T> = Mutex<HashMap<PathBuf, (SystemTime, u64, T)>>;

#[derive(Default)]
pub struct HistoryCache {
    sessions: Cache<PastSession>,
    usage: Cache<Vec<UsageRow>>,
}

fn key(path: &Path) -> Option<Key> {
    let m = std::fs::metadata(path).ok()?;
    Some((path.to_path_buf(), m.modified().ok()?, m.len()))
}

fn epoch_ms(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Cheap scan: only lines that can matter are parsed.
fn scan_session(path: &Path, modified: SystemTime) -> Option<PastSession> {
    let f = std::fs::File::open(path).ok()?;
    let mut out = PastSession {
        id: path.file_stem()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        cwd: None,
        title: None,
        first_prompt: None,
        modified: epoch_ms(modified),
        prompts: 0,
    };
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let is_user = line.contains(r#""user""#);
        let is_title = line.contains(r#""ai-title""#) || line.contains(r#""custom-title""#);
        if !is_user && !is_title {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match v["type"].as_str() {
            Some("ai-title") => out.title = v["aiTitle"].as_str().map(str::to_owned).or(out.title),
            Some("custom-title") => {
                out.title = v["customTitle"].as_str().map(str::to_owned).or(out.title)
            }
            Some("user")
                if !v["isSidechain"].as_bool().unwrap_or(false)
                    && !v["isMeta"].as_bool().unwrap_or(false) =>
            {
                if out.cwd.is_none() {
                    out.cwd = v["cwd"].as_str().map(str::to_owned);
                }
                let mut r = transcript::TranscriptReader::new(path);
                r.feed(format!("{line}\n").as_bytes());
                if let Some(p) = r.summary.first_prompt {
                    out.prompts += 1;
                    if out.first_prompt.is_none() {
                        out.first_prompt = Some(p);
                    }
                }
            }
            _ => {}
        }
    }
    (out.prompts > 0).then_some(out)
}

fn scan_usage(path: &Path, project: &str) -> Vec<UsageRow> {
    let Ok(f) = std::fs::File::open(path) else {
        return vec![];
    };
    let mut rows: BTreeMap<(String, String), UsageRow> = BTreeMap::new();
    let mut seen: HashSet<String> = HashSet::new();
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        if !line.contains(r#""usage""#) || !line.contains(r#""assistant""#) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v["type"] != "assistant" {
            continue;
        }
        let msg = &v["message"];
        let id = msg["id"].as_str().unwrap_or("").to_owned();
        if !id.is_empty() && !seen.insert(id) {
            continue;
        }
        let model = msg["model"].as_str().unwrap_or("");
        if model.starts_with('<') {
            continue;
        }
        let u = &msg["usage"];
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let write = n("cache_creation_input_tokens");
        let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"]
            .as_u64()
            .unwrap_or(0)
            .min(write);
        let t = Tokens {
            input: n("input_tokens"),
            output: n("output_tokens"),
            cache_read: n("cache_read_input_tokens"),
            cache_write_5m: write - write_1h,
            cache_write_1h: write_1h,
        };
        let day = v["timestamp"]
            .as_str()
            .and_then(local_day)
            .unwrap_or_else(|| "unknown".into());
        let r = rows
            .entry((day.clone(), model.to_owned()))
            .or_insert_with(|| UsageRow {
                day,
                project: project.to_owned(),
                model: model.to_owned(),
                ..Default::default()
            });
        r.input += t.input;
        r.output += t.output;
        r.cache_read += t.cache_read;
        r.cache_write += write;
        r.cost_usd += pricing::cost(model, &t);
    }
    rows.into_values().collect()
}

/// `YYYY-MM-DD` in local time.
fn local_day(ts: &str) -> Option<String> {
    let ms = parse_ts(ts)?;
    let secs = (ms / 1000) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&secs, &mut tm) };
    Some(format!(
        "{:04}-{:02}-{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday
    ))
}

fn project_dirs(home: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(home.join("projects"))
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
                .collect()
        })
        .unwrap_or_default()
}

impl HistoryCache {
    /// Sessions of one project (by cwd), or of all projects, newest first.
    pub fn sessions(&self, home: &Path, cwd: Option<&str>, limit: usize) -> Vec<PastSession> {
        let dirs = match cwd {
            Some(c) => vec![transcript::project_dir(home, c)],
            None => project_dirs(home),
        };
        let mut files: Vec<Key> = dirs
            .iter()
            .flat_map(|d| jsonl_files(d))
            .filter_map(|p| key(&p))
            .collect();
        files.sort_by_key(|(_, m, _)| std::cmp::Reverse(*m));
        let mut cache = self.sessions.lock().unwrap();
        let mut out = Vec::new();
        for (path, modified, len) in files {
            if out.len() >= limit {
                break;
            }
            let hit = cache
                .get(&path)
                .filter(|(m, l, _)| *m == modified && *l == len)
                .map(|(_, _, s)| s.clone());
            let s = match hit {
                Some(s) => Some(s),
                None => {
                    let s = scan_session(&path, modified);
                    if let Some(s) = &s {
                        cache.insert(path.clone(), (modified, len, s.clone()));
                    }
                    s
                }
            };
            out.extend(s);
        }
        out
    }

    /// Token usage grouped by local day, project and model, across every transcript.
    pub fn usage(&self, home: &Path) -> Vec<UsageRow> {
        let mut cache = self.usage.lock().unwrap();
        let mut out = Vec::new();
        for dir in project_dirs(home) {
            let project = dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            for path in jsonl_files(&dir) {
                let Some((_, m, l)) = key(&path) else {
                    continue;
                };
                let fresh = cache
                    .get(&path)
                    .filter(|(cm, cl, _)| *cm == m && *cl == l)
                    .map(|(_, _, r)| r.clone());
                let rows = fresh.unwrap_or_else(|| {
                    let r = scan_usage(&path, &project);
                    cache.insert(path.clone(), (m, l, r.clone()));
                    r
                });
                out.extend(rows);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/claude/fixtures/session.jsonl")
    }

    #[test]
    fn past_session() {
        let s = scan_session(&fixture(), SystemTime::now()).unwrap();
        assert_eq!(s.title.as_deref(), Some("Fix login bug"));
        assert_eq!(s.prompts, 2);
        assert_eq!(s.cwd.as_deref(), Some("/repo"));
    }

    #[test]
    fn usage_rows() {
        let rows = scan_usage(&fixture(), "p");
        let main: Vec<_> = rows
            .iter()
            .filter(|r| r.model == "claude-opus-5-5")
            .collect();
        assert_eq!(main.len(), 1);
        assert_eq!(main[0].output, 800);
        assert!(main[0].cost_usd > 0.0);
    }
}
