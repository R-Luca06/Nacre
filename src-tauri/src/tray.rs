//! Menu bar icon: new window, workspaces, Claude sessions waiting for you.

use std::sync::Mutex;

use serde::Deserialize;
use serde_json::json;
use tauri::image::Image;
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::ClaudeHub;

const ID: &str = "nacre";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Labels {
    pub new_window: String,
    pub workspaces: String,
    pub waiting: String,
    pub quit: String,
}

#[derive(Default)]
pub struct TrayState {
    enabled: Mutex<bool>,
    labels: Mutex<Labels>,
}

pub fn set(app: &AppHandle, enabled: bool, labels: Labels) -> Result<(), String> {
    let state = app.state::<TrayState>();
    *state.enabled.lock().unwrap() = enabled;
    *state.labels.lock().unwrap() = labels;
    if !enabled {
        let _ = app.remove_tray_by_id(ID);
        return Ok(());
    }
    if app.tray_by_id(ID).is_none() {
        let icon =
            Image::from_bytes(include_bytes!("../icons/tray.png")).map_err(|e| e.to_string())?;
        TrayIconBuilder::with_id(ID)
            .icon(icon)
            .icon_as_template(true)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
            .build(app)
            .map_err(|e| e.to_string())?;
    }
    refresh(app);
    Ok(())
}

/// Rebuilds the menu; cheap enough to call on every session change.
pub fn refresh(app: &AppHandle) {
    let state = app.state::<TrayState>();
    if !*state.enabled.lock().unwrap() {
        return;
    }
    let Some(tray) = app.tray_by_id(ID) else {
        return;
    };
    let labels = state.labels.lock().unwrap().clone();
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let mut items: Vec<MenuItemKind<tauri::Wry>> =
            vec![MenuItemKind::MenuItem(MenuItem::with_id(
                app,
                "tray:new-window",
                &labels.new_window,
                true,
                None::<&str>,
            )?)];
        let workspaces = crate::config::load_workspaces();
        if !workspaces.is_empty() {
            let subs: Vec<MenuItemKind<tauri::Wry>> = workspaces
                .iter()
                .filter_map(|w| {
                    let name = w.raw.as_ref()?["name"]
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| w.file.trim_end_matches(".toml").to_owned());
                    MenuItem::with_id(app, format!("tray:ws:{}", w.file), name, true, None::<&str>)
                        .ok()
                        .map(MenuItemKind::MenuItem)
                })
                .collect();
            let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = subs
                .iter()
                .map(|s| s as &dyn IsMenuItem<tauri::Wry>)
                .collect();
            items.push(MenuItemKind::Submenu(Submenu::with_items(
                app,
                &labels.workspaces,
                true,
                &refs,
            )?));
        }
        let waiting: Vec<_> = app
            .state::<ClaudeHub>()
            .sessions()
            .into_iter()
            .filter(|s| s.attention && s.pane_id.is_some())
            .collect();
        if !waiting.is_empty() {
            items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(
                app,
            )?));
            items.push(MenuItemKind::MenuItem(MenuItem::with_id(
                app,
                "tray:none",
                format!("{} · {}", labels.waiting, waiting.len()),
                false,
                None::<&str>,
            )?));
            for s in waiting.iter().take(10) {
                let project = s
                    .cwd
                    .as_deref()
                    .and_then(|c| std::path::Path::new(c).file_name())
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let title = s.title.clone().unwrap_or_else(|| "Claude".into());
                items.push(MenuItemKind::MenuItem(MenuItem::with_id(
                    app,
                    format!("tray:pane:{}", s.pane_id.as_deref().unwrap_or("")),
                    format!("{title} — {project}"),
                    true,
                    None::<&str>,
                )?));
            }
        }
        items.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(
            app,
        )?));
        items.push(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            "tray:quit",
            &labels.quit,
            true,
            None::<&str>,
        )?));
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items
            .iter()
            .map(|i| i as &dyn IsMenuItem<tauri::Wry>)
            .collect();
        Menu::with_items(app, &refs)
    };
    if let Ok(menu) = build() {
        let _ = tray.set_menu(Some(menu));
    }
}

fn some_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.label() != crate::quake::LABEL && w.is_visible().unwrap_or(false))
        .or_else(|| windows.values().find(|w| w.label() != crate::quake::LABEL))
        .cloned()
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == "tray:new-window" {
        let _ = crate::commands::window::open_window(app, &[]);
    } else if id == "tray:quit" {
        app.state::<crate::persistence::SessionStore>()
            .set_quitting();
        app.state::<crate::pty::PtyManager>().kill_all();
        app.exit(0);
    } else if let Some(file) = id.strip_prefix("tray:ws:") {
        let win = match some_window(app) {
            Some(w) => w,
            None => match crate::commands::window::open_window(app, &[]) {
                Ok(w) => w,
                Err(_) => return,
            },
        };
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to(
            win.label(),
            "remote",
            json!({ "cmd": "open-workspace", "file": file }),
        );
    } else if let Some(pane) = id.strip_prefix("tray:pane:") {
        let _ = crate::commands::window::pane_focus(
            app.clone(),
            app.state::<crate::pty::PtyManager>(),
            pane.to_owned(),
        );
    }
}
