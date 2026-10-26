//! Window/tab/split layout saved continuously and restored at launch.
//! Each window sends its own state; the file holds all open windows.

pub mod history;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Value, json};

pub struct SessionStore {
    path: PathBuf,
    windows: Mutex<BTreeMap<String, Value>>,
    /// Saved state of the previous run, handed out to restored windows.
    pending: Mutex<BTreeMap<String, Value>>,
    quitting: AtomicBool,
}

impl SessionStore {
    pub fn load(path: PathBuf) -> Self {
        let pending = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("windows").cloned())
            .and_then(|w| serde_json::from_value::<BTreeMap<String, Value>>(w).ok())
            .unwrap_or_default();
        Self {
            path,
            windows: Mutex::new(BTreeMap::new()),
            pending: Mutex::new(pending),
            quitting: AtomicBool::new(false),
        }
    }

    /// Previous windows, oldest label first.
    pub fn previous(&self) -> Vec<String> {
        self.pending.lock().unwrap().keys().cloned().collect()
    }

    pub fn take(&self, key: &str) -> Option<Value> {
        self.pending.lock().unwrap().remove(key)
    }

    pub fn save(&self, label: &str, state: Value) {
        self.windows.lock().unwrap().insert(label.to_owned(), state);
        self.flush();
    }

    /// A window closed by the user is forgotten; on quit everything is kept.
    pub fn window_closed(&self, label: &str) {
        if self.quitting.load(Ordering::Relaxed) {
            return;
        }
        self.windows.lock().unwrap().remove(label);
        self.flush();
    }

    pub fn set_quitting(&self) {
        self.quitting.store(true, Ordering::Relaxed);
    }

    fn flush(&self) {
        let windows = self.windows.lock().unwrap().clone();
        let text = json!({ "version": 1, "windows": windows }).to_string();
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let path = std::env::temp_dir().join(format!("nacre-session-{}.json", std::process::id()));
        let a = SessionStore::load(path.clone());
        a.save("w1", json!({ "tabs": [1] }));
        a.save("w2", json!({ "tabs": [2] }));
        a.window_closed("w2");
        a.set_quitting();
        a.window_closed("w1");
        let b = SessionStore::load(path.clone());
        assert_eq!(b.previous(), vec!["w1"]);
        assert_eq!(b.take("w1").unwrap()["tabs"][0], 1);
        assert!(b.take("w1").is_none());
        let _ = std::fs::remove_file(path);
    }
}
