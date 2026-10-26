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

/// Uncommitted changes of one file (staged and unstaged), as a unified diff.
#[tauri::command]
pub async fn git_diff(cwd: String, path: String) -> Result<String, String> {
    use std::process::Command;
    use std::time::Duration;
    let run = |args: &[&str]| {
        system::run_with(
            Command::new("git").args(args).current_dir(&cwd),
            Duration::from_secs(5),
            &[0, 1],
        )
    };
    let diff = run(&["--no-optional-locks", "diff", "HEAD", "--", &path])
        .filter(|d| !d.is_empty())
        .or_else(|| {
            run(&[
                "--no-optional-locks",
                "diff",
                "--no-index",
                "/dev/null",
                &path,
            ])
        });
    Ok(diff.unwrap_or_default())
}

/// Which of `paths` (absolute, or relative to `cwd`) are existing files.
#[tauri::command]
pub async fn paths_exist(
    cwd: Option<String>,
    paths: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    Ok(paths
        .iter()
        .map(|p| {
            let expanded = if let Some(rest) = p.strip_prefix("~/") {
                std::path::PathBuf::from(&home).join(rest)
            } else if p.starts_with('/') {
                std::path::PathBuf::from(p)
            } else {
                std::path::PathBuf::from(cwd.as_deref().unwrap_or(&home)).join(p)
            };
            expanded
                .is_file()
                .then(|| expanded.to_string_lossy().into_owned())
        })
        .collect())
}

/// Opens a file at a line with the configured editor command, or the default app.
#[tauri::command]
pub async fn open_in_editor(
    template: String,
    file: String,
    line: Option<u32>,
    col: Option<u32>,
) -> Result<(), String> {
    use std::process::Command;
    if template.trim().is_empty() {
        Command::new("open")
            .arg(&file)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let q = crate::pty::env::shell_quote;
    let cmd = template
        .replace("{file}", &q(&file))
        .replace("{line}", &line.unwrap_or(1).to_string())
        .replace("{col}", &col.unwrap_or(1).to_string());
    // A login shell finds editors installed in the user's PATH.
    let shell = crate::pty::env::default_shell();
    Command::new(shell)
        .args(["-l", "-c", &cmd])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Saves a file to ~/Downloads without overwriting; returns its path.
#[tauri::command]
pub async fn save_download(name: String, base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    let safe: String = name
        .chars()
        .map(|c| if c == '/' || c == '\0' { '-' } else { c })
        .collect();
    let mut path = dir.join(&safe);
    let mut n = 1;
    while path.exists() {
        let (stem, ext) = safe.rsplit_once('.').unwrap_or((&safe, ""));
        path = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
