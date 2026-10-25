use serde::Deserialize;
use tauri::menu::{IsMenuItem, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Entry {
    Item {
        id: String,
        label: String,
        accel: Option<String>,
    },
    Separator,
    Predefined {
        name: String,
        label: Option<String>,
    },
    Submenu {
        label: String,
        items: Vec<Entry>,
        #[serde(default)]
        window: bool,
    },
}

fn build_items<R: Runtime>(
    app: &AppHandle<R>,
    entries: &[Entry],
) -> tauri::Result<Vec<MenuItemKind<R>>> {
    let mut out = Vec::new();
    for e in entries {
        out.push(match e {
            Entry::Item { id, label, accel } => {
                let plain = || MenuItemBuilder::with_id(id.as_str(), label);
                // Unsupported accelerators (e.g. chords) leave the item without one.
                let item = match accel {
                    Some(a) => plain()
                        .accelerator(a)
                        .build(app)
                        .or_else(|_| plain().build(app))?,
                    None => plain().build(app)?,
                };
                MenuItemKind::MenuItem(item)
            }
            Entry::Separator => MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
            Entry::Predefined { name, label } => {
                let l = label.as_deref();
                MenuItemKind::Predefined(match name.as_str() {
                    "about" => PredefinedMenuItem::about(app, l, None)?,
                    "hide" => PredefinedMenuItem::hide(app, l)?,
                    "hideOthers" => PredefinedMenuItem::hide_others(app, l)?,
                    "showAll" => PredefinedMenuItem::show_all(app, l)?,
                    "services" => PredefinedMenuItem::services(app, l)?,
                    "minimize" => PredefinedMenuItem::minimize(app, l)?,
                    "zoom" => PredefinedMenuItem::maximize(app, l)?,
                    "undo" => PredefinedMenuItem::undo(app, l)?,
                    "redo" => PredefinedMenuItem::redo(app, l)?,
                    "cut" => PredefinedMenuItem::cut(app, l)?,
                    _ => PredefinedMenuItem::separator(app)?,
                })
            }
            Entry::Submenu {
                label,
                items,
                window,
            } => {
                let children = build_items(app, items)?;
                let refs: Vec<&dyn IsMenuItem<R>> =
                    children.iter().map(|c| c as &dyn IsMenuItem<R>).collect();
                let sub = Submenu::with_items(app, label, true, &refs)?;
                #[cfg(target_os = "macos")]
                if *window {
                    let _ = sub.set_as_windows_menu_for_nsapp();
                }
                #[cfg(not(target_os = "macos"))]
                let _ = window;
                MenuItemKind::Submenu(sub)
            }
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn menu_set(app: AppHandle, entries: Vec<Entry>) -> Result<(), String> {
    let items = build_items(&app, &entries).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|c| c as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    let menu = Menu::with_items(&app, &refs).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// Routes a menu click to the focused window, or opens one if none exists.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let windows = app.webview_windows();
    let target = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next());
    match target {
        Some(w) => {
            let _ = app.emit_to(w.label(), "menu-action", id);
        }
        None if matches!(id, "tab.new" | "window.new") => {
            let _ = super::window::open_window(app, &[]);
        }
        None => {}
    }
}
