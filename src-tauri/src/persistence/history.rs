//! Global command history (all panes, all sessions) and directory frecency.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub command: String,
    pub cwd: Option<String>,
    pub exit: Option<i32>,
    /// Epoch seconds.
    pub ts: i64,
}

const MAX_ENTRIES: usize = 50_000;

pub struct History {
    path: PathBuf,
    entries: Mutex<Vec<Entry>>,
}

impl History {
    pub fn load(path: PathBuf) -> Self {
        let entries = std::fs::File::open(&path)
            .map(|f| {
                BufReader::new(f)
                    .lines()
                    .map_while(Result::ok)
                    .filter_map(|l| serde_json::from_str(&l).ok())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    pub fn append(&self, e: Entry) {
        if e.command.trim().is_empty() {
            return;
        }
        let mut entries = self.entries.lock().unwrap();
        entries.push(e.clone());
        if entries.len() > MAX_ENTRIES * 2 {
            // Compact: keep the most recent half, rewrite the file.
            let at = entries.len() - MAX_ENTRIES;
            let keep = entries.split_off(at);
            *entries = keep;
            let text: String = entries
                .iter()
                .filter_map(|x| serde_json::to_string(x).ok())
                .map(|l| l + "\n")
                .collect();
            let _ = std::fs::write(&self.path, text);
            return;
        }
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            && let Ok(line) = serde_json::to_string(&e)
        {
            let _ = writeln!(f, "{line}");
        }
    }

    /// Newest first, one row per distinct command; `query` filters by substring words.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Entry> {
        let words: Vec<String> = query.split_whitespace().map(|w| w.to_lowercase()).collect();
        let entries = self.entries.lock().unwrap();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for e in entries.iter().rev() {
            let lower = e.command.to_lowercase();
            if !words.iter().all(|w| lower.contains(w.as_str())) {
                continue;
            }
            if seen.insert(e.command.clone()) {
                out.push(e.clone());
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct DirStat {
    rank: f64,
    last: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub path: String,
    pub score: f64,
}

/// zoxide-style frecency: rank grows with visits, weighted by recency.
pub struct Dirs {
    path: PathBuf,
    dirs: Mutex<HashMap<String, DirStat>>,
}

const MAX_RANK_SUM: f64 = 10_000.0;

pub fn frecency(rank: f64, last: i64, now: i64) -> f64 {
    let age = now - last;
    let weight = if age < 3600 {
        4.0
    } else if age < 86_400 {
        2.0
    } else if age < 604_800 {
        0.5
    } else {
        0.25
    };
    rank * weight
}

impl Dirs {
    pub fn load(path: PathBuf) -> Self {
        let dirs = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Self {
            path,
            dirs: Mutex::new(dirs),
        }
    }

    pub fn visit(&self, dir: &str, now: i64) {
        let mut dirs = self.dirs.lock().unwrap();
        let e = dirs.entry(dir.to_owned()).or_default();
        e.rank += 1.0;
        e.last = now;
        // Aging, as in zoxide: scale down and forget rarely used dirs.
        let sum: f64 = dirs.values().map(|d| d.rank).sum();
        if sum > MAX_RANK_SUM {
            for d in dirs.values_mut() {
                d.rank *= 0.9;
            }
            dirs.retain(|_, d| d.rank >= 1.0);
        }
        if let Ok(text) = serde_json::to_string(&*dirs) {
            let _ = std::fs::write(&self.path, text);
        }
    }

    pub fn top(&self, query: &str, now: i64, limit: usize) -> Vec<DirEntry> {
        let words: Vec<String> = query.split_whitespace().map(|w| w.to_lowercase()).collect();
        let dirs = self.dirs.lock().unwrap();
        let mut v: Vec<DirEntry> = dirs
            .iter()
            .filter(|(p, _)| {
                let lower = p.to_lowercase();
                words.iter().all(|w| lower.contains(w.as_str()))
            })
            .filter(|(p, _)| std::path::Path::new(p).is_dir())
            .map(|(p, d)| DirEntry {
                path: p.clone(),
                score: frecency(d.rank, d.last, now),
            })
            .collect();
        v.sort_by(|a, b| b.score.total_cmp(&a.score));
        v.truncate(limit);
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nacre-{name}-{}", std::process::id()))
    }

    #[test]
    fn history_dedupes_and_searches() {
        let p = tmp("hist.jsonl");
        let _ = std::fs::remove_file(&p);
        let h = History::load(p.clone());
        for (i, c) in ["git status", "ls", "git status", "git push"]
            .iter()
            .enumerate()
        {
            h.append(Entry {
                command: c.to_string(),
                cwd: None,
                exit: Some(0),
                ts: i as i64,
            });
        }
        let all = h.search("", 10);
        assert_eq!(
            all.iter().map(|e| e.command.as_str()).collect::<Vec<_>>(),
            vec!["git push", "git status", "ls"]
        );
        assert_eq!(h.search("GIT", 10).len(), 2);
        let reloaded = History::load(p.clone());
        assert_eq!(reloaded.search("", 10).len(), 3);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn frecency_prefers_recent_and_frequent() {
        let p = tmp("dirs.json");
        let d = Dirs::load(p.clone());
        let now = 1_000_000;
        let tmpdir = std::env::temp_dir().to_string_lossy().into_owned();
        d.visit("/", now - 700_000);
        d.visit("/", now - 700_000);
        d.visit(&tmpdir, now);
        let top = d.top("", now, 10);
        assert_eq!(top[0].path, tmpdir);
        assert!(frecency(10.0, now, now) > frecency(10.0, now - 90_000, now));
        let _ = std::fs::remove_file(p);
    }
}
