mod commands;
mod ipc_socket;
mod process;
mod pty;

use tauri::{Manager, RunEvent, WindowEvent};

use process::ProcessInspector;
use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::default())
        .manage(ProcessInspector::default())
        .manage(ipc_socket::DebugState::default())
        .setup(|app| {
            if let Err(e) = ipc_socket::start(app.handle().clone()) {
                eprintln!("nacre: socket unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_ack,
            commands::pty_kill,
            commands::pty_info,
            ipc_socket::debug::debug_result,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<PtyManager>().kill_owned_by(window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<PtyManager>().kill_all();
        }
    });
}
