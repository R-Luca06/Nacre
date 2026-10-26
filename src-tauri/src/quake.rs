//! Drop-down terminal toggled by a global shortcut.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const LABEL: &str = "quake";

pub struct QuakeState {
    pub height: Mutex<f64>,
    pub hide_on_blur: Mutex<bool>,
}

impl Default for QuakeState {
    fn default() -> Self {
        Self {
            height: Mutex::new(0.45),
            hide_on_blur: Mutex::new(true),
        }
    }
}

pub fn configure(
    app: &AppHandle,
    enabled: bool,
    shortcut: &str,
    height: f64,
    hide_on_blur: bool,
) -> Result<(), String> {
    let state = app.state::<QuakeState>();
    *state.height.lock().unwrap() = height.clamp(0.2, 1.0);
    *state.hide_on_blur.lock().unwrap() = hide_on_blur;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if !enabled {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.hide();
        }
        return Ok(());
    }
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    })
    .map_err(|e| format!("Shortcut \"{shortcut}\" unavailable: {e}"))
}

fn place(app: &AppHandle, w: &tauri::WebviewWindow) {
    let ratio = *app.state::<QuakeState>().height.lock().unwrap();
    let monitor = app
        .webview_windows()
        .values()
        .find(|x| x.label() != LABEL && x.is_focused().unwrap_or(false))
        .and_then(|x| x.current_monitor().ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let area = m.work_area();
        let h = (area.size.height as f64 * ratio) as u32;
        let _ = w.set_size(PhysicalSize::new(area.size.width, h));
        let _ = w.set_position(PhysicalPosition::new(area.position.x, area.position.y));
    }
}

pub fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            place(app, &w);
            let _ = w.show();
            let _ = w.set_focus();
        }
        return;
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?quake=1".into()))
        .title("Nacre")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .transparent(true)
        .visible(false)
        .build();
    if let Ok(w) = built {
        place(app, &w);
    }
}

pub fn on_blur(app: &AppHandle) {
    if *app.state::<QuakeState>().hide_on_blur.lock().unwrap()
        && let Some(w) = app.get_webview_window(LABEL)
    {
        let _ = w.hide();
    }
}
