use tauri::State;

use crate::persistence::history::{DirEntry, Dirs, Entry, History};
use crate::system::ssh::{self, SshHost};

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn history_add(
    history: State<'_, History>,
    command: String,
    cwd: Option<String>,
    exit: Option<i32>,
) {
    history.append(Entry {
        command,
        cwd,
        exit,
        ts: now(),
    });
}

#[tauri::command]
pub async fn history_prefix(
    history: State<'_, History>,
    prefix: String,
    cwd: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    Ok(history.prefix(&prefix, cwd.as_deref(), limit.unwrap_or(10)))
}

/// `scripts` of the nearest package.json, for `npm run` completion.
#[tauri::command]
pub async fn package_scripts(cwd: String) -> Vec<String> {
    let mut dir = Some(std::path::PathBuf::from(cwd));
    while let Some(d) = dir {
        if let Ok(text) = std::fs::read_to_string(d.join("package.json")) {
            return serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("scripts")?.as_object().map(|m| m.keys().cloned().collect()))
                .unwrap_or_default();
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }
    vec![]
}

#[tauri::command]
pub async fn history_search(
    history: State<'_, History>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Entry>, String> {
    Ok(history.search(&query, limit.unwrap_or(200)))
}

#[tauri::command]
pub fn dirs_visit(dirs: State<'_, Dirs>, path: String) {
    dirs.visit(&path, now());
}

#[tauri::command]
pub async fn dirs_top(
    dirs: State<'_, Dirs>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    Ok(dirs.top(&query, now(), limit.unwrap_or(100)))
}

#[tauri::command]
pub async fn ssh_hosts() -> Result<Vec<SshHost>, String> {
    Ok(ssh::hosts())
}
