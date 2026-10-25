use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{State, Webview};

use crate::process::{ProcInfo, ProcessInspector};
use crate::pty::{ExitInfo, PtyManager, SpawnOptions};

#[tauri::command]
pub fn pty_spawn(
    webview: Webview,
    pty: State<'_, PtyManager>,
    id: String,
    opts: SpawnOptions,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<ExitInfo>,
) -> Result<u32, String> {
    pty.spawn(
        id,
        webview.label().to_owned(),
        opts,
        vec![],
        on_data,
        on_exit,
    )
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
pub fn pty_info(
    pty: State<'_, PtyManager>,
    inspector: State<'_, ProcessInspector>,
    id: String,
) -> Result<Option<ProcInfo>, String> {
    let (shell, fg) = pty.pids(&id)?;
    Ok(inspector.inspect(shell, fg))
}
