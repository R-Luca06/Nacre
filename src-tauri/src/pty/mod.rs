pub mod env;
pub mod log;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{ChildKiller, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};

/// Unacknowledged bytes above which the reader pauses until the frontend catches up.
const HIGH_WATER: usize = 8 * 1024 * 1024;
const LOW_WATER: usize = 2 * 1024 * 1024;
const MAX_BATCH: usize = 1024 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub command: Option<String>,
    /// Shell integration (OSC 7/133); on unless disabled.
    pub integration: Option<bool>,
    /// Keep all output on disk.
    pub keep_log: Option<bool>,
    /// Where, set by the backend.
    #[serde(skip)]
    pub log: Option<PathBuf>,
    /// Set by the backend: how to start the interactive shell when `args` is unset.
    #[serde(skip)]
    pub interactive_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitInfo {
    pub code: Option<u32>,
    pub signal: Option<String>,
}

#[derive(Default)]
struct Flow {
    unacked: Mutex<usize>,
    cv: Condvar,
}

impl Flow {
    fn add(&self, n: usize) {
        *self.unacked.lock().unwrap() += n;
    }

    fn ack(&self, n: usize) {
        let mut u = self.unacked.lock().unwrap();
        *u = u.saturating_sub(n);
        if *u <= LOW_WATER {
            self.cv.notify_all();
        }
    }

    fn wait(&self) {
        let mut u = self.unacked.lock().unwrap();
        while *u > HIGH_WATER {
            let (guard, timeout) = self.cv.wait_timeout(u, Duration::from_secs(2)).unwrap();
            u = guard;
            // A webview that stopped acking must not stall the shell forever.
            if timeout.timed_out() {
                *u = 0;
            }
        }
    }
}

/// Where output goes. Empty while a tab moves between windows: output waits in `pending`.
#[derive(Default)]
struct Sink {
    data: Option<Channel<InvokeResponseBody>>,
    exit: Option<Channel<ExitInfo>>,
    pending: Vec<u8>,
    exited: Option<ExitInfo>,
}

struct Pane {
    owner: Mutex<String>,
    sink: Arc<Mutex<Sink>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    flow: Arc<Flow>,
    log: Option<PathBuf>,
}

#[derive(Default)]
pub struct PtyManager {
    panes: Mutex<HashMap<String, Arc<Pane>>>,
}

impl PtyManager {
    pub fn spawn(
        &self,
        id: String,
        owner: String,
        opts: SpawnOptions,
        extra_env: Vec<(String, String)>,
        on_data: Channel<InvokeResponseBody>,
        on_exit: Channel<ExitInfo>,
    ) -> Result<u32, String> {
        if self.panes.lock().unwrap().contains_key(&id) {
            return Err(format!("pane {id} already has a shell"));
        }
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows: opts.rows.max(1),
                cols: opts.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Cannot open a pty: {e}"))?;

        let cwd = opts
            .cwd
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .or_else(dirs_home);
        let cmd = env::build_command(&opts, cwd, &id, extra_env);
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Cannot start the shell: {e}"))?;
        drop(pair.slave);

        let pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let flow = Arc::new(Flow::default());
        let sink = Arc::new(Mutex::new(Sink {
            data: Some(on_data),
            exit: Some(on_exit),
            ..Default::default()
        }));
        let pane = Arc::new(Pane {
            owner: Mutex::new(owner),
            sink: sink.clone(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(child.clone_killer()),
            pid,
            flow: flow.clone(),
            log: opts.log.clone(),
        });
        self.panes.lock().unwrap().insert(id.clone(), pane);

        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let read_flow = flow.clone();
        let mut log = opts.log.clone().and_then(|p| log::Log::open(p).ok());
        thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    read_flow.wait();
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            read_flow.add(n);
                            if let Some(l) = log.as_mut() {
                                l.write(&buf[..n], n < buf.len());
                            }
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        thread::Builder::new()
            .name(format!("pty-send-{id}"))
            .spawn(move || {
                // Coalesce whatever piled up while the previous send was in flight:
                // no added latency when idle, large batches under load.
                while let Ok(mut batch) = rx.recv() {
                    while batch.len() < MAX_BATCH {
                        match rx.try_recv() {
                            Ok(more) => batch.extend_from_slice(&more),
                            Err(_) => break,
                        }
                    }
                    let mut s = sink.lock().unwrap();
                    match &s.data {
                        Some(ch) => {
                            if ch.send(InvokeResponseBody::Raw(batch)).is_err() {
                                break;
                            }
                        }
                        None => {
                            s.pending.extend_from_slice(&batch);
                            let over = s.pending.len().saturating_sub(HIGH_WATER);
                            s.pending.drain(..over);
                        }
                    }
                }
                let status = child.wait().ok();
                let info = ExitInfo {
                    code: status.as_ref().map(|s| s.exit_code()),
                    signal: status.and_then(|s| s.signal().map(str::to_owned)),
                };
                let mut s = sink.lock().unwrap();
                match &s.exit {
                    Some(ch) => {
                        let _ = ch.send(info);
                    }
                    None => s.exited = Some(info),
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(pid.unwrap_or(0))
    }

    fn get(&self, id: &str) -> Result<Arc<Pane>, String> {
        self.panes
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no pane {id}"))
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let pane = self.get(id)?;
        let mut w = pane.writer.lock().unwrap();
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let pane = self.get(id)?;
        let master = pane.master.lock().unwrap();
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn ack(&self, id: &str, bytes: usize) {
        if let Ok(pane) = self.get(id) {
            pane.flow.ack(bytes);
        }
    }

    pub fn kill(&self, id: &str) {
        let pane = self.panes.lock().unwrap().remove(id);
        if let Some(pane) = pane {
            let _ = pane.killer.lock().unwrap().kill();
            pane.flow.ack(usize::MAX);
            if let Some(p) = &pane.log {
                let _ = std::fs::remove_file(p);
                let _ = std::fs::remove_file(log::rotated(p));
            }
        }
    }

    /// Holds output until `attach`; the shell keeps running.
    pub fn detach(&self, id: &str) -> Result<(), String> {
        let pane = self.get(id)?;
        // Ownerless, so closing the source window does not kill it.
        pane.owner.lock().unwrap().clear();
        let mut s = pane.sink.lock().unwrap();
        s.data = None;
        s.exit = None;
        Ok(())
    }

    /// Sends output to another window, starting with what piled up meanwhile.
    pub fn attach(
        &self,
        id: &str,
        owner: String,
        on_data: Channel<InvokeResponseBody>,
        on_exit: Channel<ExitInfo>,
    ) -> Result<u32, String> {
        let pane = self.get(id)?;
        *pane.owner.lock().unwrap() = owner;
        let mut s = pane.sink.lock().unwrap();
        let pending = std::mem::take(&mut s.pending);
        if !pending.is_empty() {
            on_data
                .send(InvokeResponseBody::Raw(pending))
                .map_err(|e| e.to_string())?;
        }
        if let Some(info) = s.exited.take() {
            let _ = on_exit.send(info);
        }
        s.data = Some(on_data);
        s.exit = Some(on_exit);
        Ok(pane.pid.unwrap_or(0))
    }

    pub fn kill_owned_by(&self, owner: &str) {
        let ids: Vec<String> = self
            .panes
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p)| *p.owner.lock().unwrap() == owner)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.kill(&id);
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self.panes.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.kill(&id);
        }
    }

    /// The on-disk output of a pane, oldest part first.
    pub fn log_files(&self, id: &str) -> Vec<PathBuf> {
        let Ok(pane) = self.get(id) else {
            return vec![];
        };
        let Some(p) = &pane.log else {
            return vec![];
        };
        [log::rotated(p), p.clone()]
            .into_iter()
            .filter(|f| f.exists())
            .collect()
    }

    pub fn owner_of(&self, id: &str) -> Option<String> {
        self.panes
            .lock()
            .unwrap()
            .get(id)
            .map(|p| p.owner.lock().unwrap().clone())
    }

    pub fn all_pids(&self) -> Vec<(Option<u32>, Option<u32>)> {
        let ids: Vec<String> = self.panes.lock().unwrap().keys().cloned().collect();
        ids.iter().filter_map(|id| self.pids(id).ok()).collect()
    }

    /// Shell pid and current foreground process group leader.
    pub fn pids(&self, id: &str) -> Result<(Option<u32>, Option<u32>), String> {
        let pane = self.get(id)?;
        let fg = pane
            .master
            .lock()
            .unwrap()
            .process_group_leader()
            .and_then(|p| u32::try_from(p).ok());
        Ok((pane.pid, fg))
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
