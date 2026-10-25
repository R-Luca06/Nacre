//! Debug-build helpers to drive and inspect the UI from scripts.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default)]
pub struct DebugState {
    next: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
}

#[tauri::command]
pub fn debug_result(state: tauri::State<'_, DebugState>, id: u64, value: Value) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(value);
    }
}

fn window(app: &AppHandle, req: &Value) -> Result<WebviewWindow, String> {
    match req["window"].as_str() {
        Some(label) => app.get_webview_window(label),
        None => app
            .webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
            .or_else(|| app.webview_windows().into_values().next()),
    }
    .ok_or_else(|| "no window".to_string())
}

pub fn eval(app: &AppHandle, req: &Value) -> Result<Value, String> {
    let js = req["js"].as_str().ok_or("missing \"js\"")?;
    let win = window(app, req)?;
    let state = app.state::<DebugState>();
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(id, tx);
    let script = format!(
        "(async () => {{ let r; try {{ r = {{ ok: true, value: await (async () => {{ {js} }})() }}; }} \
         catch (e) {{ r = {{ ok: false, error: String(e && e.stack || e) }}; }} \
         window.__TAURI_INTERNALS__.invoke('debug_result', {{ id: {id}, value: r }}); }})()"
    );
    win.eval(script).map_err(|e| e.to_string())?;
    let out = rx.recv_timeout(Duration::from_secs(10));
    state.pending.lock().unwrap().remove(&id);
    out.map_err(|_| "eval timed out".to_string())
}

#[cfg(target_os = "macos")]
pub fn snapshot(app: &AppHandle, req: &Value) -> Result<Value, String> {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::WKWebView;

    let path = req["path"].as_str().ok_or("missing \"path\"")?.to_owned();
    let win = window(app, req)?;
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    win.with_webview(move |wv| {
        let tx = tx.clone();
        let block = block2::RcBlock::new(move |img: *mut NSImage, err: *mut NSError| {
            let res = if img.is_null() {
                Err(if err.is_null() {
                    "snapshot failed".into()
                } else {
                    unsafe { (*err).localizedDescription().to_string() }
                })
            } else {
                unsafe { (*img).TIFFRepresentation() }
                    .map(|d| d.to_vec())
                    .ok_or_else(|| "no image data".to_string())
            };
            let _ = tx.send(res);
        });
        unsafe {
            let view: &WKWebView = &*(wv.inner() as *const WKWebView);
            view.takeSnapshotWithConfiguration_completionHandler(None, &block);
        }
    })
    .map_err(|e| e.to_string())?;
    let bytes = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "snapshot timed out".to_string())??;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(json!({ "path": path }))
}

#[cfg(not(target_os = "macos"))]
pub fn snapshot(_app: &AppHandle, _req: &Value) -> Result<Value, String> {
    Err("snapshot is only available on macOS".into())
}
