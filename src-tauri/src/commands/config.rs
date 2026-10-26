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
pub fn workspaces_load() -> Vec<ThemeFile> {
    config::load_workspaces()
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
    save_named(&config::themes_dir(), &file, &contents)
}

/// Current config.toml text (empty when it does not exist yet).
#[tauri::command]
pub fn config_read() -> String {
    std::fs::read_to_string(config::config_path()).unwrap_or_default()
}

/// Replaces config.toml after checking it parses; keeps a backup.
#[tauri::command]
pub fn config_replace(contents: String) -> Result<String, String> {
    config::parse_toml(&contents)?;
    let path = config::config_path();
    let backup = path.with_extension("toml.bak");
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(backup.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn workspace_save(file: String, contents: String) -> Result<String, String> {
    save_named(&config::workspaces_dir(), &file, &contents)
}

/// Writes `<dir>/<file>.toml` with a filesystem-safe name; returns the path.
fn save_named(dir: &std::path::Path, file: &str, contents: &str) -> Result<String, String> {
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
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.toml"));
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
