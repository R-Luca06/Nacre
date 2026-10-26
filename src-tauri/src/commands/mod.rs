pub mod ai;
pub mod claude;
pub mod config;
pub mod menu;
pub mod system;
pub mod window;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, State, Webview};

use crate::process::{ProcInfo, ProcessInspector};
use crate::pty::{ExitInfo, PtyManager, SpawnOptions};

#[tauri::command]
pub fn pty_spawn(
    webview: Webview,
    pty: State<'_, PtyManager>,
    paths: State<'_, crate::AppPaths>,
    id: String,
    mut opts: SpawnOptions,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<ExitInfo>,
) -> Result<u32, String> {
    let mut env = vec![
        (
            "NACRE_SOCKET".into(),
            paths.socket.to_string_lossy().into_owned(),
        ),
        ("NACRE_BIN".into(), paths.cli.to_string_lossy().into_owned()),
    ];
    if opts.integration != Some(false) && opts.args.is_none() {
        let shell = crate::pty::env::resolve_shell(opts.shell.as_deref());
        if let Some(inj) = crate::shell_integration::injection(&paths.shell, &shell) {
            env.extend(inj.env);
            opts.interactive_args = inj.args;
        }
    }
    pty.spawn(id, webview.label().to_owned(), opts, env, on_data, on_exit)
}

#[tauri::command]
pub fn pty_write(pty: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    pty.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(
    pty: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_ack(pty: State<'_, PtyManager>, id: String, bytes: usize) {
    pty.ack(&id, bytes);
}

#[tauri::command]
pub fn pty_kill(pty: State<'_, PtyManager>, id: String) {
    pty.kill(&id);
}

#[tauri::command]
pub async fn pty_info(
    pty: State<'_, PtyManager>,
    inspector: State<'_, ProcessInspector>,
    id: String,
) -> Result<Option<ProcInfo>, String> {
    let (shell, fg) = pty.pids(&id)?;
    Ok(inspector.inspect(shell, fg))
}

/// A reloaded webview starts clean: shells from its previous page are killed.
#[tauri::command]
pub fn pty_reset(webview: Webview, pty: State<'_, PtyManager>) {
    pty.kill_owned_by(webview.label());
}

/// Names of programs running in any pane of any window.
#[tauri::command]
pub async fn pty_busy(
    pty: State<'_, PtyManager>,
    inspector: State<'_, ProcessInspector>,
) -> Result<Vec<String>, String> {
    Ok(pty
        .all_pids()
        .into_iter()
        .filter_map(|(shell, fg)| inspector.inspect(shell, fg))
        .filter(|p| !p.is_shell)
        .map(|p| p.name)
        .collect())
}

#[tauri::command]
pub fn app_quit(app: tauri::AppHandle) {
    app.state::<crate::persistence::SessionStore>()
        .set_quitting();
    app.state::<PtyManager>().kill_all();
    app.exit(0);
}

#[tauri::command]
pub fn session_save(
    webview: Webview,
    store: State<'_, crate::persistence::SessionStore>,
    state: serde_json::Value,
) {
    store.save(webview.label(), state);
}

#[tauri::command]
pub fn session_take(
    store: State<'_, crate::persistence::SessionStore>,
    key: String,
) -> Option<serde_json::Value> {
    store.take(&key)
}
