pub mod debug;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::thread;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub use debug::DebugState;

pub fn socket_path() -> PathBuf {
    let uid = unsafe { libc::getuid() };
    let name = if cfg!(debug_assertions) {
        format!("nacre-dev-{uid}.sock")
    } else {
        format!("nacre-{uid}.sock")
    };
    std::env::temp_dir().join(name)
}

pub fn start(app: AppHandle) -> std::io::Result<PathBuf> {
    let path = socket_path();
    if UnixStream::connect(&path).is_err() {
        let _ = std::fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path)?;
    thread::Builder::new()
        .name("ipc-socket".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let app = app.clone();
                thread::spawn(move || serve(app, stream));
            }
        })?;
    Ok(path)
}

fn serve(app: AppHandle, stream: UnixStream) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut writer = stream;
    for line in BufReader::new(read_half).lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(req) => match dispatch(&app, &req) {
                Ok(data) => json!({ "ok": true, "data": data }),
                Err(error) => json!({ "ok": false, "error": error }),
            },
            Err(e) => json!({ "ok": false, "error": format!("invalid JSON: {e}") }),
        };
        if writeln!(writer, "{reply}").is_err() {
            break;
        }
    }
}

fn dispatch(app: &AppHandle, req: &Value) -> Result<Value, String> {
    let cmd = req["cmd"].as_str().ok_or("missing \"cmd\"")?;
    match cmd {
        "ping" => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        "debug.eval" if cfg!(debug_assertions) => debug::eval(app, req),
        "debug.snapshot" if cfg!(debug_assertions) => debug::snapshot(app, req),
        "debug.windows" if cfg!(debug_assertions) => Ok(json!(
            app.webview_windows().keys().cloned().collect::<Vec<_>>()
        )),
        _ => Err(format!("unknown command \"{cmd}\"")),
    }
}
