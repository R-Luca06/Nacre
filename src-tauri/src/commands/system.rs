use std::collections::HashMap;

use tauri::State;

use crate::process::ProcessInspector;
use crate::pty::PtyManager;
use crate::system::{self, GitStatus, Stats, SystemMonitor, Tool, ToolCache};

#[tauri::command]
pub async fn system_stats(monitor: State<'_, SystemMonitor>) -> Result<Stats, String> {
    Ok(monitor.stats())
}

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<Option<GitStatus>, String> {
    Ok(system::git_status(&cwd))
}

#[tauri::command]
pub async fn project_tools(cache: State<'_, ToolCache>, cwd: String) -> Result<Vec<Tool>, String> {
    Ok(cache.project_tools(&cwd))
}

#[tauri::command]
pub async fn run_script(
    command: String,
    cwd: Option<String>,
    timeout: Option<u64>,
) -> Result<Option<String>, String> {
    Ok(system::run_script(
        &command,
        cwd.as_deref(),
        timeout.unwrap_or(5000),
    ))
}

#[tauri::command]
pub async fn contexts() -> Result<HashMap<&'static str, String>, String> {
    let mut out = HashMap::new();
    if let Some(k) = system::kube_context() {
        out.insert("kube", k);
    }
    if let Some(d) = system::docker_context() {
        out.insert("docker", d);
    }
    Ok(out)
}

/// Environment of the pane's shell (e.g. `AWS_PROFILE`, `VIRTUAL_ENV`).
#[tauri::command]
pub async fn pane_env(
    pty: State<'_, PtyManager>,
    inspector: State<'_, ProcessInspector>,
    id: String,
    keys: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let (shell, fg) = pty.pids(&id)?;
    let Some(pid) = fg.or(shell) else {
        return Ok(HashMap::new());
    };
    Ok(inspector.env(pid, &keys))
}
