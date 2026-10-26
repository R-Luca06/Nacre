//! Reads `~/.config/nacre/config.toml` and `themes/*.toml`, watches them, and
//! sends raw values to the frontend, which owns defaults and validation.

pub mod edit;

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub fn config_dir() -> PathBuf {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(xdg).join("nacre");
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".config").join("nacre")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

pub fn themes_dir() -> PathBuf {
    config_dir().join("themes")
}

#[derive(Debug, Clone, Serialize)]
pub struct Loaded {
    pub path: String,
    pub raw: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeFile {
    pub file: String,
    pub raw: Option<Value>,
    pub error: Option<String>,
}

/// Parses TOML into JSON, with a one-line error naming the line.
pub fn parse_toml(text: &str) -> Result<Value, String> {
    match toml::from_str::<toml::Table>(text) {
        Ok(table) => serde_json::to_value(table).map_err(|e| e.to_string()),
        Err(e) => {
            let line = e
                .span()
                .map(|s| text[..s.start.min(text.len())].lines().count().max(1));
            let msg = e.message().trim().to_string();
            Err(match line {
                Some(l) => format!("config.toml line {l}: {msg}"),
                None => format!("config.toml: {msg}"),
            })
        }
    }
}

pub fn load() -> Loaded {
    let path = config_path();
    let display = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => match parse_toml(&text) {
            Ok(raw) => Loaded {
                path: display,
                raw: Some(raw),
                error: None,
            },
            Err(error) => Loaded {
                path: display,
                raw: None,
                error: Some(error),
            },
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Loaded {
            path: display,
            raw: Some(Value::Object(Default::default())),
            error: None,
        },
        Err(e) => Loaded {
            path: display,
            raw: None,
            error: Some(format!("Cannot read config.toml: {e}")),
        },
    }
}

pub fn workspaces_dir() -> PathBuf {
    config_dir().join("workspaces")
}

pub fn load_themes() -> Vec<ThemeFile> {
    load_dir(&themes_dir(), "themes")
}

pub fn load_workspaces() -> Vec<ThemeFile> {
    load_dir(&workspaces_dir(), "workspaces")
}

/// Every `*.toml` in `dir`, parsed; errors name the file.
fn load_dir(dir: &Path, label: &str) -> Vec<ThemeFile> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut out: Vec<ThemeFile> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "toml"))
        .map(|p| {
            let file = p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            match std::fs::read_to_string(&p).map_err(|e| e.to_string()) {
                Ok(text) => match parse_toml(&text) {
                    Ok(raw) => ThemeFile {
                        file,
                        raw: Some(raw),
                        error: None,
                    },
                    Err(e) => ThemeFile {
                        error: Some(e.replacen("config.toml", &format!("{label}/{file}"), 1)),
                        file,
                        raw: None,
                    },
                },
                Err(e) => ThemeFile {
                    file,
                    raw: None,
                    error: Some(e),
                },
            }
        })
        .collect();
    out.sort_by(|a, b| a.file.cmp(&b.file));
    out
}

/// Writes the commented default file once; never overwrites.
pub fn init(template: &str) -> Result<bool, String> {
    let path = config_path();
    if path.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(themes_dir()).map_err(|e| e.to_string())?;
    std::fs::write(&path, template).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Watches the config directory; emits `config-changed` / `themes-changed` (debounced).
pub fn watch(app: AppHandle) {
    let dir = config_dir();
    let _ = std::fs::create_dir_all(themes_dir());
    thread::Builder::new()
        .name("config-watch".into())
        .spawn(move || {
            let (tx, rx) = mpsc::channel();
            let Ok(mut watcher) = notify::recommended_watcher(tx) else {
                return;
            };
            if watcher.watch(&dir, RecursiveMode::Recursive).is_err() {
                return;
            }
            let config = config_path();
            let themes = themes_dir();
            let workspaces = workspaces_dir();
            while let Ok(first) = rx.recv() {
                let mut events = vec![first];
                while let Ok(e) = rx.recv_timeout(Duration::from_millis(120)) {
                    events.push(e);
                }
                let paths: Vec<PathBuf> =
                    events.into_iter().flatten().flat_map(|e| e.paths).collect();
                if paths.iter().any(|p| same_file(p, &config)) {
                    let _ = app.emit("config-changed", load());
                }
                if paths
                    .iter()
                    .any(|p| p.starts_with(&themes) || same_file(p, &themes))
                {
                    let _ = app.emit("themes-changed", load_themes());
                }
                if paths
                    .iter()
                    .any(|p| p.starts_with(&workspaces) || same_file(p, &workspaces))
                {
                    let _ = app.emit("workspaces-changed", load_workspaces());
                }
            }
        })
        .ok();
}

fn same_file(a: &Path, b: &Path) -> bool {
    a == b
        || a.file_name() == b.file_name()
            && a.parent().and_then(|p| p.canonicalize().ok())
                == b.parent().and_then(|p| p.canonicalize().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_reports_line() {
        let v = parse_toml("[font]\nsize = 14\n").unwrap();
        assert_eq!(v["font"]["size"], 14);
        let e = parse_toml("[font]\nsize = = 14\n").unwrap_err();
        assert!(e.starts_with("config.toml line 2"), "{e}");
    }
}
