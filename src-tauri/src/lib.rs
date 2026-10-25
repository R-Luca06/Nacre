mod claude;
mod commands;
mod config;
mod ipc_socket;
mod process;
mod pty;
mod system;

use tauri::{Manager, RunEvent, WindowEvent};

use std::path::PathBuf;

use process::ProcessInspector;

/// Where the CLI lives and where it should connect; injected into every shell.
pub struct AppPaths {
    pub socket: PathBuf,
    pub cli: PathBuf,
}

fn cli_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("nacre")))
        .unwrap_or_else(|| PathBuf::from("nacre"))
}
use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .manage(ProcessInspector::default())
        .manage(system::SystemMonitor::default())
        .manage(system::ToolCache::default())
        .manage(ipc_socket::DebugState::default())
        .manage(claude::ClaudeHub::new())
        .manage(claude::history::HistoryCache::default())
        .manage(AppPaths {
            socket: ipc_socket::socket_path(),
            cli: cli_path(),
        })
        .setup(|app| {
            if let Err(e) = ipc_socket::start(app.handle().clone()) {
                eprintln!("nacre: socket unavailable: {e}");
            }
            config::watch(app.handle().clone());
            app.state::<claude::ClaudeHub>().start(app.handle().clone());
            commands::window::open_window(app.handle(), &[])?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_ack,
            commands::pty_kill,
            commands::pty_info,
            commands::pty_reset,
            commands::config::config_load,
            commands::config::config_init,
            commands::config::config_set,
            commands::config::themes_load,
            commands::config::theme_save,
            commands::menu::menu_set,
            commands::claude::claude_sessions,
            commands::claude::claude_ack,
            commands::claude::claude_detect,
            commands::claude::claude_release,
            commands::claude::claude_badge,
            commands::claude::claude_history,
            commands::claude::claude_usage,
            commands::claude::claude_install_status,
            commands::claude::claude_install,
            commands::claude::claude_uninstall,
            commands::claude::notify,
            commands::system::system_stats,
            commands::system::git_status,
            commands::system::project_tools,
            commands::system::run_script,
            commands::system::contexts,
            commands::system::pane_env,
            commands::app_quit,
            commands::pty_busy,
            commands::window::window_new,
            commands::window::window_ready,
            ipc_socket::debug::debug_result,
        ])
        .on_menu_event(|app, event| commands::menu::on_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<PtyManager>().kill_owned_by(window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| match event {
        RunEvent::Exit => handle.state::<PtyManager>().kill_all(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let _ = commands::window::open_window(handle, &[]);
        }
        _ => {}
    });
}
