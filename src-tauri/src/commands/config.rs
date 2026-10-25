use serde_json::Value;

use crate::config::{self, Loaded, ThemeFile};

#[tauri::command]
pub fn config_load() -> Loaded {
    config::load()
}

#[tauri::command]
pub fn config_init(template: String) -> Result<bool, String> {
    config::init(&template)
}

#[tauri::command]
pub fn themes_load() -> Vec<ThemeFile> {
    config::load_themes()
}

#[tauri::command]
pub fn config_set(path: Vec<String>, value: Value) -> Result<(), String> {
    let file = config::config_path();
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    let out = config::edit::set(&text, &path, &value)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, out).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_save(file: String, contents: String) -> Result<String, String> {
    let name: String = file
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let dir = config::themes_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.toml"));
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
