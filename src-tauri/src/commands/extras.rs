use tauri::AppHandle;

use crate::tray::{self, Labels};

#[tauri::command]
pub fn quake_configure(
    app: AppHandle,
    enabled: bool,
    shortcut: String,
    height: f64,
    hide_on_blur: bool,
) -> Result<(), String> {
    crate::quake::configure(&app, enabled, &shortcut, height, hide_on_blur)
}

#[tauri::command]
pub fn quake_toggle(app: AppHandle) {
    crate::quake::toggle(&app);
}

#[tauri::command]
pub fn tray_set(app: AppHandle, enabled: bool, labels: Labels) -> Result<(), String> {
    tray::set(&app, enabled, labels)
}

#[cfg(target_os = "macos")]
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn EnableSecureEventInput() -> i32;
    fn DisableSecureEventInput() -> i32;
}

/// Secure Keyboard Entry: other apps cannot read keystrokes while it is on.
#[tauri::command]
pub fn secure_input(enabled: bool) {
    #[cfg(target_os = "macos")]
    unsafe {
        if enabled {
            EnableSecureEventInput();
        } else {
            DisableSecureEventInput();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = enabled;
}
