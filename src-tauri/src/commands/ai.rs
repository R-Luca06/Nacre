use serde_json::Value;
use tauri::State;
use tauri::ipc::Channel;

use crate::ai::{self, AiRequest, AiRuns};

#[tauri::command]
pub fn ai_run(runs: State<'_, AiRuns>, id: String, req: AiRequest, on_event: Channel<Value>) {
    runs.run(id, req, on_event);
}

#[tauri::command]
pub fn ai_cancel(runs: State<'_, AiRuns>, id: String) {
    runs.cancel(&id);
}

#[tauri::command]
pub async fn ai_status(claude_path: Option<String>) -> Result<Value, String> {
    Ok(serde_json::json!({
        "claude": ai::claude_binary(claude_path.as_deref()).map(|p| p.to_string_lossy().into_owned()),
        "apiKey": ai::api_key().is_some(),
    }))
}

#[tauri::command]
pub fn ai_set_key(key: Option<String>) -> Result<(), String> {
    ai::set_api_key(key.as_deref())
}
