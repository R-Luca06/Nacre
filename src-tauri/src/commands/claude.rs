use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, State};

use crate::AppPaths;
use crate::claude::history::{HistoryCache, PastSession, UsageRow};
use crate::claude::install::{self, Status};
use crate::claude::{ClaudeHub, Session, claude_home};

#[tauri::command]
pub fn claude_sessions(hub: State<'_, ClaudeHub>) -> Vec<Session> {
    hub.sessions()
}

#[tauri::command]
pub fn claude_ack(app: AppHandle, hub: State<'_, ClaudeHub>, pane: String) {
    hub.ack(&app, &pane);
}

#[tauri::command]
pub async fn claude_detect(
    app: AppHandle,
    hub: State<'_, ClaudeHub>,
    pane: String,
    cwd: String,
) -> Result<Option<String>, String> {
    Ok(hub.detect(&app, &pane, &cwd))
}

#[tauri::command]
pub fn claude_badge(app: AppHandle, hub: State<'_, ClaudeHub>, enabled: bool) {
    hub.set_badge_enabled(&app, enabled);
}

#[tauri::command]
pub fn claude_release(app: AppHandle, hub: State<'_, ClaudeHub>, pane: String) {
    hub.pane_released(&app, &pane);
}

#[tauri::command]
pub async fn claude_history(
    cache: State<'_, HistoryCache>,
    cwd: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<PastSession>, String> {
    let home = claude_home().ok_or("No home directory")?;
    Ok(cache.sessions(&home, cwd.as_deref(), limit.unwrap_or(50)))
}

#[tauri::command]
pub async fn claude_usage(cache: State<'_, HistoryCache>) -> Result<Vec<UsageRow>, String> {
    let home = claude_home().ok_or("No home directory")?;
    Ok(cache.usage(&home))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(claude_home()
        .ok_or("No home directory")?
        .join("settings.json"))
}

fn state_path() -> PathBuf {
    crate::config::config_dir().join("claude-install.json")
}

fn read_json(path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().is_empty() => Ok(json!({})),
        Ok(t) => serde_json::from_str(&t)
            .map_err(|e| format!("{} is not valid JSON ({e}); fix it first.", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    #[serde(flatten)]
    status: Status,
    settings_path: String,
    cli_path: String,
}

#[tauri::command]
pub fn claude_install_status(paths: State<'_, AppPaths>) -> Result<InstallInfo, String> {
    let path = settings_path()?;
    let settings = read_json(&path)?;
    Ok(InstallInfo {
        status: install::status(&settings),
        settings_path: path.to_string_lossy().into_owned(),
        cli_path: paths.cli.to_string_lossy().into_owned(),
    })
}

/// Called only after the user confirmed in the UI. Backs up settings.json first.
#[tauri::command]
pub fn claude_install(paths: State<'_, AppPaths>, statusline: bool) -> Result<String, String> {
    let path = settings_path()?;
    let settings = read_json(&path)?;
    let state = read_json(&state_path()).unwrap_or(json!({}));
    let saved = state.get("statusLine");
    let backup = backup(&path)?;
    let bin = paths.cli.to_string_lossy();
    let (next, original) = install::install(settings, &bin, statusline, saved);
    write_json(&path, &next)?;
    let _ = std::fs::create_dir_all(crate::config::config_dir());
    write_json(
        &state_path(),
        &json!({ "statusLine": original, "backup": backup }),
    )?;
    Ok(backup)
}

#[tauri::command]
pub fn claude_uninstall() -> Result<String, String> {
    let path = settings_path()?;
    let settings = read_json(&path)?;
    let state = read_json(&state_path()).unwrap_or(json!({}));
    let backup = backup(&path)?;
    let next = install::uninstall(settings, state.get("statusLine"));
    write_json(&path, &next)?;
    let _ = std::fs::remove_file(state_path());
    Ok(backup)
}

fn backup(path: &PathBuf) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = path.with_file_name(format!("settings.json.nacre-{stamp}.bak"));
    std::fs::copy(path, &dest).map_err(|e| format!("Backup failed: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn write_json(path: &PathBuf, v: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n";
    let tmp = path.with_extension("json.nacre-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}
