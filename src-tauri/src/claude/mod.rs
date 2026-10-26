//! Live Claude Code sessions: hook events and status line data (pushed through
//! the socket by the `nacre` CLI) combined with transcripts read incrementally.

pub mod history;
pub mod install;
pub mod pricing;
pub mod transcript;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use transcript::{TranscriptReader, TranscriptSummary};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Waiting for the user to type (idle prompt).
    Idle,
    Thinking,
    Tool,
    /// Needs a permission decision.
    Permission,
    /// Finished a turn; the user has not looked yet.
    Done,
    Compacting,
    Ended,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimits {
    pub five_hour_pct: Option<f64>,
    pub five_hour_resets_at: Option<i64>,
    pub seven_day_pct: Option<f64>,
    pub seven_day_resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub pane_id: Option<String>,
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub model_name: Option<String>,
    pub state: State,
    pub tool: Option<String>,
    pub message: Option<String>,
    /// Set when Claude finished or asks something; cleared once seen.
    pub attention: bool,
    pub started_at: i64,
    pub updated_at: i64,
    pub context_tokens: u64,
    pub context_window: u64,
    pub context_pct: f64,
    pub cost_usd: f64,
    /// True when `cost_usd` comes from Claude Code itself rather than our estimate.
    pub cost_exact: bool,
    pub duration_ms: Option<u64>,
    pub prompts: u32,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub rate_limits: Option<RateLimits>,
    pub detected: bool,
    #[serde(flatten)]
    pub summary: SummaryView,
}

/// The parts of a transcript summary sent to the UI.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryView {
    pub totals: transcript::TokenTotals,
    pub todos: Vec<transcript::Todo>,
    pub files: Vec<String>,
    pub timeline: Vec<(i64, u64)>,
    pub first_prompt: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Session {
    fn new(id: &str) -> Self {
        let now = now_ms();
        Self {
            id: id.to_owned(),
            pane_id: None,
            cwd: None,
            transcript_path: None,
            title: None,
            model: None,
            model_name: None,
            state: State::Idle,
            tool: None,
            message: None,
            attention: false,
            started_at: now,
            updated_at: now,
            context_tokens: 0,
            context_window: 200_000,
            context_pct: 0.0,
            cost_usd: 0.0,
            cost_exact: false,
            duration_ms: None,
            prompts: 0,
            lines_added: None,
            lines_removed: None,
            rate_limits: None,
            detected: false,
            summary: SummaryView::default(),
        }
    }

    fn apply_summary(&mut self, s: &TranscriptSummary, window_from_statusline: bool) {
        if let Some(m) = &s.model {
            self.set_model(m);
        }
        if s.title.is_some() {
            self.title = s.title.clone();
        }
        self.context_tokens = s.context_tokens;
        if !window_from_statusline {
            self.context_window = self
                .model
                .as_deref()
                .map_or(200_000, pricing::context_window);
        }
        self.context_pct = pct(self.context_tokens, self.context_window);
        if !self.cost_exact {
            self.cost_usd = s.cost_usd;
        }
        self.prompts = s.prompts;
        if let Some(ts) = s.first_ts.as_deref().and_then(transcript::parse_ts) {
            self.started_at = self.started_at.min(ts);
        }
        self.summary = SummaryView {
            totals: s.totals,
            todos: s.todos.clone(),
            files: s.files.iter().cloned().collect(),
            timeline: s.timeline.clone(),
            first_prompt: s.first_prompt.clone(),
        };
    }

    fn set_model(&mut self, m: &str) {
        if self.model.as_deref() != Some(m) {
            self.model = Some(m.to_owned());
            self.model_name = Some(pricing::display_name(m));
        }
    }
}

fn pct(tokens: u64, window: u64) -> f64 {
    if window == 0 {
        0.0
    } else {
        (tokens as f64 / window as f64 * 1000.0).round() / 10.0
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attention {
    pub session_id: String,
    pub pane_id: Option<String>,
    pub kind: &'static str,
    pub title: String,
    pub message: String,
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, Session>,
    readers: HashMap<String, TranscriptReader>,
    window_from_statusline: HashMap<String, bool>,
    dirty: bool,
}

#[derive(Clone)]
pub struct ClaudeHub {
    inner: Arc<Mutex<Inner>>,
    badge: Arc<AtomicBool>,
}

impl ClaudeHub {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            badge: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn set_badge_enabled(&self, app: &AppHandle, on: bool) {
        self.badge.store(on, Ordering::Relaxed);
        self.inner.lock().unwrap().dirty = true;
        self.flush(app);
    }

    pub fn sessions(&self) -> Vec<Session> {
        let mut v: Vec<Session> = self
            .inner
            .lock()
            .unwrap()
            .sessions
            .values()
            .cloned()
            .collect();
        v.sort_by_key(|s| -s.started_at);
        v
    }

    /// Background: polls transcripts every second and pushes changes to all windows.
    pub fn start(&self, app: AppHandle) {
        let hub = self.clone();
        thread::Builder::new()
            .name("claude-hub".into())
            .spawn(move || {
                let mut tick = 0u64;
                loop {
                    thread::sleep(Duration::from_millis(1000));
                    hub.poll_transcripts();
                    hub.flush(&app);
                    tick += 1;
                    if tick.is_multiple_of(60) {
                        hub.prune();
                    }
                }
            })
            .ok();
    }

    fn poll_transcripts(&self) {
        let mut g = self.inner.lock().unwrap();
        let ids: Vec<String> = g
            .sessions
            .values()
            .filter(|s| s.state != State::Ended || now_ms() - s.updated_at < 5_000)
            .map(|s| s.id.clone())
            .collect();
        for id in ids {
            let changed = g.readers.get_mut(&id).is_some_and(|r| r.poll());
            if changed {
                let summary = g.readers[&id].summary.clone();
                let fixed = g.window_from_statusline.get(&id).copied().unwrap_or(false);
                if let Some(s) = g.sessions.get_mut(&id) {
                    s.apply_summary(&summary, fixed);
                    s.updated_at = now_ms();
                }
                g.dirty = true;
            }
        }
    }

    fn flush(&self, app: &AppHandle) {
        let (dirty, list) = {
            let mut g = self.inner.lock().unwrap();
            let d = std::mem::take(&mut g.dirty);
            (
                d,
                if d {
                    g.sessions.values().cloned().collect::<Vec<_>>()
                } else {
                    vec![]
                },
            )
        };
        if dirty {
            let _ = app.emit("claude-sessions", &list);
            let waiting = list.iter().filter(|s| s.attention).count();
            let on = self.badge.load(Ordering::Relaxed);
            set_badge(app, if on { waiting } else { 0 });
            crate::tray::refresh(app);
        }
    }

    fn session_mut<'a>(g: &'a mut Inner, id: &str) -> &'a mut Session {
        g.sessions
            .entry(id.to_owned())
            .or_insert_with(|| Session::new(id))
    }

    fn attach_transcript(g: &mut Inner, id: &str, path: &str) {
        if path.is_empty() {
            return;
        }
        let same = g
            .readers
            .get(id)
            .is_some_and(|r| r.path == std::path::Path::new(path));
        if !same {
            let mut r = TranscriptReader::new(path);
            r.poll();
            let summary = r.summary.clone();
            g.readers.insert(id.to_owned(), r);
            let fixed = g.window_from_statusline.get(id).copied().unwrap_or(false);
            let s = Self::session_mut(g, id);
            s.transcript_path = Some(path.to_owned());
            s.apply_summary(&summary, fixed);
        }
    }

    /// A pane hosts one session: binding a new one ends the previous binding.
    fn bind_pane(g: &mut Inner, id: &str, pane: Option<&str>) {
        let Some(pane) = pane.filter(|p| !p.is_empty()) else {
            return;
        };
        for s in g.sessions.values_mut() {
            if s.id != id && s.pane_id.as_deref() == Some(pane) && s.state != State::Ended {
                s.state = State::Ended;
                s.attention = false;
                s.updated_at = now_ms();
            }
        }
        Self::session_mut(g, id).pane_id = Some(pane.to_owned());
    }

    /// Hook payload from `nacre claude-event`.
    pub fn hook(&self, app: &AppHandle, pane: Option<&str>, p: &Value) -> Option<Attention> {
        let id = p["session_id"].as_str()?;
        let event = p["hook_event_name"].as_str().unwrap_or("");
        let mut g = self.inner.lock().unwrap();
        Self::bind_pane(&mut g, id, pane);
        if let Some(t) = p["transcript_path"].as_str() {
            Self::attach_transcript(&mut g, id, t);
        }
        let s = Self::session_mut(&mut g, id);
        if let Some(c) = p["cwd"].as_str() {
            s.cwd = Some(c.to_owned());
        }
        if let Some(m) = p["model"].as_str() {
            s.set_model(m);
        }
        s.updated_at = now_ms();
        s.detected = false;
        let mut attention = None;
        match event {
            "SessionStart" => {
                s.state = State::Idle;
                s.tool = None;
            }
            "UserPromptSubmit" => {
                s.state = State::Thinking;
                s.attention = false;
                s.message = None;
            }
            "PreToolUse" => {
                s.state = State::Tool;
                s.tool = p["tool_name"].as_str().map(str::to_owned);
            }
            "PostToolUse" | "PostToolUseFailure" => {
                if s.state != State::Ended {
                    s.state = State::Thinking;
                    s.tool = None;
                }
            }
            "PermissionRequest" => {
                s.state = State::Permission;
                s.tool = p["tool_name"].as_str().map(str::to_owned);
                s.attention = true;
                let msg = format!("{} needs approval", s.tool.as_deref().unwrap_or("A tool"));
                s.message = Some(msg.clone());
                attention = Some(("permission", msg));
            }
            "Notification" => {
                let kind = p["notification_type"].as_str().unwrap_or("");
                let msg = p["message"].as_str().unwrap_or("").to_owned();
                match kind {
                    "permission_prompt" => {
                        s.state = State::Permission;
                        s.attention = true;
                        attention = Some(("permission", msg.clone()));
                    }
                    "idle_prompt" | "elicitation_dialog" => {
                        if s.state != State::Done {
                            s.state = State::Idle;
                        }
                        s.attention = true;
                        attention = Some(("input", msg.clone()));
                    }
                    _ => {}
                }
                if !msg.is_empty() {
                    s.message = Some(msg);
                }
            }
            "Stop" => {
                s.state = State::Done;
                s.tool = None;
                s.attention = true;
                let last = p["last_assistant_message"]
                    .as_str()
                    .map(|m| {
                        m.lines()
                            .find(|l| !l.trim().is_empty())
                            .unwrap_or("")
                            .to_owned()
                    })
                    .unwrap_or_default();
                s.message = None;
                attention = Some(("done", last));
            }
            "PreCompact" => s.state = State::Compacting,
            "SessionEnd" => {
                s.state = State::Ended;
                s.attention = false;
                s.tool = None;
            }
            _ => {}
        }
        let result = attention.map(|(kind, message)| Attention {
            session_id: s.id.clone(),
            pane_id: s.pane_id.clone(),
            kind,
            title: s.title.clone().unwrap_or_else(|| "Claude".into()),
            message,
        });
        g.dirty = true;
        drop(g);
        self.flush(app);
        result
    }

    /// Status line payload from `nacre statusline`: Claude Code's own numbers win.
    pub fn statusline(&self, app: &AppHandle, pane: Option<&str>, p: &Value) {
        let Some(id) = p["session_id"].as_str() else {
            return;
        };
        let mut g = self.inner.lock().unwrap();
        Self::bind_pane(&mut g, id, pane);
        if let Some(t) = p["transcript_path"].as_str() {
            Self::attach_transcript(&mut g, id, t);
        }
        let window = p["context_window"]["context_window_size"].as_u64();
        if window.is_some() {
            g.window_from_statusline.insert(id.to_owned(), true);
        }
        let s = Self::session_mut(&mut g, id);
        if let Some(m) = p["model"]["id"].as_str() {
            s.set_model(m);
        }
        if let Some(n) = p["model"]["display_name"].as_str() {
            s.model_name = Some(n.to_owned());
        }
        if let Some(c) = p["workspace"]["current_dir"].as_str().or(p["cwd"].as_str()) {
            s.cwd = Some(c.to_owned());
        }
        if let Some(n) = p["session_name"].as_str() {
            s.title = Some(n.to_owned());
        }
        let cw = &p["context_window"];
        if let Some(w) = window {
            s.context_window = w;
        }
        if let Some(u) = cw["current_usage"].as_object() {
            let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
            s.context_tokens =
                n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        }
        s.context_pct = cw["used_percentage"]
            .as_f64()
            .unwrap_or_else(|| pct(s.context_tokens, s.context_window));
        if let Some(c) = p["cost"]["total_cost_usd"].as_f64() {
            s.cost_usd = c;
            s.cost_exact = true;
        }
        s.duration_ms = p["cost"]["total_duration_ms"].as_u64();
        s.lines_added = p["cost"]["total_lines_added"].as_u64();
        s.lines_removed = p["cost"]["total_lines_removed"].as_u64();
        let rl = &p["rate_limits"];
        if rl.is_object() {
            s.rate_limits = Some(RateLimits {
                five_hour_pct: rl["five_hour"]["used_percentage"].as_f64(),
                five_hour_resets_at: rl["five_hour"]["resets_at"].as_i64(),
                seven_day_pct: rl["seven_day"]["used_percentage"].as_f64(),
                seven_day_resets_at: rl["seven_day"]["resets_at"].as_i64(),
            });
        }
        s.updated_at = now_ms();
        g.dirty = true;
        drop(g);
        self.flush(app);
    }

    /// The user looked at the pane: clear its attention flag.
    pub fn ack(&self, app: &AppHandle, pane: &str) {
        let mut g = self.inner.lock().unwrap();
        let mut changed = false;
        for s in g.sessions.values_mut() {
            if s.pane_id.as_deref() == Some(pane) && s.attention {
                s.attention = false;
                if s.state == State::Done {
                    s.state = State::Idle;
                }
                changed = true;
            }
        }
        if changed {
            g.dirty = true;
            drop(g);
            self.flush(app);
        }
    }

    /// Without hooks: a pane runs `claude`; bind the newest recent transcript of its project.
    pub fn detect(&self, app: &AppHandle, pane: &str, cwd: &str) -> Option<String> {
        {
            let g = self.inner.lock().unwrap();
            if g.sessions
                .values()
                .any(|s| s.pane_id.as_deref() == Some(pane) && s.state != State::Ended)
            {
                return None;
            }
        }
        let home = claude_home()?;
        let dir = transcript::project_dir(&home, cwd);
        let bound: Vec<String> = self
            .inner
            .lock()
            .unwrap()
            .sessions
            .values()
            .filter(|s| s.state != State::Ended)
            .filter_map(|s| s.transcript_path.clone())
            .collect();
        let newest = std::fs::read_dir(&dir)
            .ok()?
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .filter(|e| !bound.contains(&e.path().to_string_lossy().into_owned()))
            .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
            .filter(|(m, _)| m.elapsed().is_ok_and(|d| d < Duration::from_secs(600)))
            .max_by_key(|(m, _)| *m)?
            .1;
        let id = newest.file_stem()?.to_string_lossy().into_owned();
        let mut g = self.inner.lock().unwrap();
        Self::bind_pane(&mut g, &id, Some(pane));
        Self::attach_transcript(&mut g, &id, &newest.to_string_lossy());
        let s = Self::session_mut(&mut g, &id);
        s.cwd = Some(cwd.to_owned());
        s.detected = true;
        s.state = State::Idle;
        g.dirty = true;
        drop(g);
        self.flush(app);
        Some(id)
    }

    /// The pane's shell is back in the foreground: a detected session is over.
    pub fn pane_released(&self, app: &AppHandle, pane: &str) {
        let mut g = self.inner.lock().unwrap();
        let mut changed = false;
        for s in g.sessions.values_mut() {
            if s.pane_id.as_deref() == Some(pane) && s.state != State::Ended {
                s.state = State::Ended;
                s.attention = false;
                s.updated_at = now_ms();
                changed = true;
            }
        }
        if changed {
            g.dirty = true;
            drop(g);
            self.flush(app);
        }
    }

    /// Drops ended sessions older than an hour.
    pub fn prune(&self) {
        let mut g = self.inner.lock().unwrap();
        let cutoff = now_ms() - 3_600_000;
        let old: Vec<String> = g
            .sessions
            .values()
            .filter(|s| s.state == State::Ended && s.updated_at < cutoff)
            .map(|s| s.id.clone())
            .collect();
        for id in old {
            g.sessions.remove(&id);
            g.readers.remove(&id);
            g.window_from_statusline.remove(&id);
        }
    }
}

pub fn claude_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude"))
}

fn set_badge(app: &AppHandle, count: usize) {
    #[cfg(target_os = "macos")]
    if let Some(w) = app.webview_windows().values().next() {
        let _ = w.set_badge_count(if count == 0 { None } else { Some(count as i64) });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);
}
