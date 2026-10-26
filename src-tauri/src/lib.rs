mod ai;
mod claude;
mod commands;
mod config;
mod ipc_socket;
mod persistence;
mod process;
mod pty;
mod shell_integration;
mod system;

use tauri::{Manager, RunEvent, WindowEvent};

use std::path::PathBuf;

use process::ProcessInspector;

/// Where the CLI lives and where it should connect; injected into every shell.
pub struct AppPaths {
    pub socket: PathBuf,
    pub cli: PathBuf,
    /// Shell integration scripts.
    pub shell: PathBuf,
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
        .manage(ai::AiRuns::default())
        .manage(claude::history::HistoryCache::default())
        .setup(|app| {
            let data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("nacre"));
            let shell = shell_integration::default_dir(data.clone());
            if let Err(e) = shell_integration::install(&shell) {
                eprintln!("nacre: shell integration unavailable: {e}");
            }
            app.manage(AppPaths {
                socket: ipc_socket::socket_path(),
                cli: cli_path(),
                shell,
            });
            if let Err(e) = ipc_socket::start(app.handle().clone()) {
                eprintln!("nacre: socket unavailable: {e}");
            }
            config::watch(app.handle().clone());
            app.state::<claude::ClaudeHub>().start(app.handle().clone());
            let store = persistence::SessionStore::load(data.join("session.json"));
            let restore = config::load()
                .raw
                .as_ref()
                .and_then(|r| r["general"]["restore_session"].as_bool())
                .unwrap_or(true);
            let previous = if restore { store.previous() } else { vec![] };
            app.manage(store);
            if previous.is_empty() {
                commands::window::open_window(app.handle(), &[])?;
            }
            for key in previous {
                commands::window::open_window(app.handle(), &[("restore", &key)])?;
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
            commands::pty_reset,
            commands::config::config_load,
            commands::config::config_init,
            commands::config::config_set,
            commands::config::themes_load,
            commands::config::theme_save,
            commands::config::workspaces_load,
            commands::config::config_read,
            commands::config::config_replace,
            commands::config::workspace_save,
            commands::menu::menu_set,
            commands::ai::ai_run,
            commands::ai::ai_cancel,
            commands::ai::ai_status,
            commands::ai::ai_set_key,
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
            commands::session_save,
            commands::session_take,
            commands::window::pane_focus,
            commands::system::git_diff,
            commands::system::save_download,
            commands::window::window_ready,
            ipc_socket::debug::debug_result,
        ])
        .on_menu_event(|app, event| commands::menu::on_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<PtyManager>().kill_owned_by(window.label());
                window
                    .state::<persistence::SessionStore>()
                    .window_closed(window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| match event {
        RunEvent::ExitRequested { .. } => {
            handle.state::<persistence::SessionStore>().set_quitting()
        }
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
