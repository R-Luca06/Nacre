use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{
    AppHandle, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

static NEXT: AtomicU32 = AtomicU32::new(1);

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn open_window<R: Runtime>(
    app: &AppHandle<R>,
    params: &[(&str, &str)],
) -> tauri::Result<WebviewWindow<R>> {
    let label = format!("w{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    let url = if query.is_empty() {
        "index.html".to_string()
    } else {
        format!("index.html?{}", query.join("&"))
    };
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Nacre")
        .inner_size(1000.0, 640.0)
        .min_inner_size(360.0, 200.0)
        // Always transparent so opacity and blur can change without a new window.
        .transparent(true)
        .visible(false);
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(12.0, 16.0));
    }
    // Cascade from the focused window.
    if let Some(focused) = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        && let (Ok(pos), Ok(scale)) = (focused.outer_position(), focused.scale_factor())
    {
        let p = pos.to_logical::<f64>(scale);
        builder = builder.position(p.x + 24.0, p.y + 24.0);
    } else {
        builder = builder.center();
    }
    let window = builder.build()?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    keep_rendering_when_occluded(&window);
    Ok(window)
}

/// Debug builds keep rendering behind other windows so scripted snapshots work.
#[cfg(all(debug_assertions, target_os = "macos"))]
fn keep_rendering_when_occluded<R: Runtime>(window: &WebviewWindow<R>) {
    use objc2::runtime::{AnyObject, Bool, Sel};
    use objc2::{msg_send, sel};
    let _ = window.with_webview(|wv| unsafe {
        let view = wv.inner() as *mut AnyObject;
        let selector: Sel = sel!(_setWindowOcclusionDetectionEnabled:);
        let responds: Bool = msg_send![view, respondsToSelector: selector];
        if responds.as_bool() {
            let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: Bool::NO];
        }
    });
}

#[tauri::command]
pub fn window_new(app: AppHandle, cwd: Option<String>) -> Result<String, String> {
    let params: Vec<(&str, &str)> = cwd.as_deref().map(|c| ("cwd", c)).into_iter().collect();
    open_window(&app, &params)
        .map(|w| w.label().to_owned())
        .map_err(|e| e.to_string())
}

/// Brings the window that owns `pane` to the front and focuses the pane.
#[tauri::command]
pub fn pane_focus(
    app: AppHandle,
    pty: tauri::State<'_, crate::pty::PtyManager>,
    pane: String,
) -> Result<(), String> {
    use tauri::Emitter;
    let owner = pty.owner_of(&pane).ok_or("Pane closed.")?;
    let win = app.get_webview_window(&owner).ok_or("Window closed.")?;
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    app.emit_to(
        owner.as_str(),
        "remote",
        serde_json::json!({ "cmd": "focus-pane", "pane": pane }),
    )
    .map_err(|e| e.to_string())
}

/// The frontend shows the window once its first frame is ready, avoiding a white flash.
#[tauri::command]
pub fn window_ready(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}
