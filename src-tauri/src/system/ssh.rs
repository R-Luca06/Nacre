//! Hosts from `~/.ssh/config` (and its `Include`s), for the SSH picker.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    pub name: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<String>,
}

fn expand(p: &str, home: &Path, base: &Path) -> Vec<PathBuf> {
    let p = if let Some(rest) = p.strip_prefix("~/") {
        home.join(rest)
    } else if p.starts_with('/') {
        PathBuf::from(p)
    } else {
        base.join(p)
    };
    let s = p.to_string_lossy();
    if !s.contains('*') {
        return vec![p];
    }
    // Only `dir/*` style globs, which is what Include usually uses.
    let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
    let pat = p
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (pre, post) = pat.split_once('*').unwrap_or((&pat, ""));
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|f| {
                    let n = f
                        .file_name()
                        .map(|x| x.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    n.starts_with(pre) && n.ends_with(post)
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

pub fn parse(text: &str, home: &Path, base: &Path, depth: u8, out: &mut Vec<SshHost>) {
    let mut current: Vec<usize> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (
                k.to_lowercase(),
                v.trim().trim_start_matches('=').trim().to_owned(),
            ),
            None => continue,
        };
        match key.as_str() {
            "host" => {
                current.clear();
                for name in value.split_whitespace() {
                    if name.contains(['*', '?', '!']) {
                        continue;
                    }
                    if !out.iter().any(|h| h.name == name) {
                        out.push(SshHost {
                            name: name.to_owned(),
                            hostname: None,
                            user: None,
                            port: None,
                        });
                    }
                    current.push(out.iter().position(|h| h.name == name).unwrap());
                }
            }
            "match" => current.clear(),
            "hostname" | "user" | "port" => {
                for &i in &current {
                    let h = &mut out[i];
                    let slot = match key.as_str() {
                        "hostname" => &mut h.hostname,
                        "user" => &mut h.user,
                        _ => &mut h.port,
                    };
                    if slot.is_none() {
                        *slot = Some(value.clone());
                    }
                }
            }
            "include" if depth < 4 => {
                for p in value.split_whitespace().flat_map(|p| expand(p, home, base)) {
                    if let Ok(t) = std::fs::read_to_string(&p) {
                        parse(&t, home, base, depth + 1, out);
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn hosts() -> Vec<SshHost> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return vec![];
    };
    let base = home.join(".ssh");
    let mut out = Vec::new();
    if let Ok(t) = std::fs::read_to_string(base.join("config")) {
        parse(&t, &home, &base, 0, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hosts() {
        let text = "Host *\n  ServerAliveInterval 30\nHost prod web1\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\nHost dev\n  Hostname=dev.local\n";
        let mut out = Vec::new();
        parse(text, Path::new("/h"), Path::new("/h/.ssh"), 0, &mut out);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].name, "prod");
        assert_eq!(out[0].hostname.as_deref(), Some("10.0.0.5"));
        assert_eq!(out[1].user.as_deref(), Some("deploy"));
        assert_eq!(out[2].hostname.as_deref(), Some("dev.local"));
    }
}
