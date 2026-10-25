//! Adds Nacre's hooks and status line to `~/.claude/settings.json` without
//! touching anything else, and removes exactly what it added.

use serde_json::{Value, json};

/// Events forwarded to Nacre. All run `nacre claude-event`, which is silent and fast.
pub const EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "PreCompact",
    "SessionEnd",
];

const MARK: &str = "# nacre";

fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Runs only inside Nacre and never fails Claude, even if the app is gone.
pub fn hook_command(bin: &str) -> String {
    format!(
        "[ -n \"$NACRE_SOCKET\" ] && [ -x {b} ] && {b} claude-event; true {MARK}",
        b = q(bin)
    )
}

pub fn statusline_command(bin: &str, wrapped: Option<&str>) -> String {
    match wrapped {
        Some(w) => format!(
            "{b} statusline --wrap {} 2>/dev/null || {w} {MARK}",
            q(w),
            b = q(bin)
        ),
        None => format!("{b} statusline {MARK}", b = q(bin)),
    }
}

pub fn is_ours(cmd: &str) -> bool {
    cmd.trim_end().ends_with(MARK)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub hooks: bool,
    pub statusline: bool,
    /// The user's own status line command, kept and wrapped.
    pub existing_statusline: Option<String>,
}

fn group_has_ours(group: &Value) -> bool {
    group["hooks"].as_array().is_some_and(|hs| {
        hs.iter()
            .any(|h| h["command"].as_str().is_some_and(is_ours))
    })
}

pub fn status(settings: &Value) -> Status {
    let hooks = EVENTS.iter().all(|e| {
        settings["hooks"][e]
            .as_array()
            .is_some_and(|groups| groups.iter().any(group_has_ours))
    });
    let cmd = settings["statusLine"]["command"].as_str();
    Status {
        hooks,
        statusline: cmd.is_some_and(is_ours),
        existing_statusline: cmd.filter(|c| !is_ours(c)).map(str::to_owned),
    }
}

/// Removes Nacre's entries, leaving empty containers out.
pub fn uninstall(mut settings: Value, original_statusline: Option<&Value>) -> Value {
    if let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) {
        for groups in hooks.values_mut() {
            if let Some(arr) = groups.as_array_mut() {
                for g in arr.iter_mut() {
                    if let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                        hs.retain(|h| !h["command"].as_str().is_some_and(is_ours));
                    }
                }
                arr.retain(|g| g["hooks"].as_array().is_none_or(|hs| !hs.is_empty()));
            }
        }
        hooks.retain(|_, groups| groups.as_array().is_none_or(|a| !a.is_empty()));
        if hooks.is_empty()
            && let Some(obj) = settings.as_object_mut()
        {
            obj.remove("hooks");
        }
    }
    let ours = settings["statusLine"]["command"]
        .as_str()
        .is_some_and(is_ours);
    if ours && let Some(obj) = settings.as_object_mut() {
        match original_statusline {
            Some(orig) if !orig.is_null() => {
                obj.insert("statusLine".into(), orig.clone());
            }
            _ => {
                obj.remove("statusLine");
            }
        }
    }
    settings
}

/// Adds hooks and the status line. `saved` is the user's status line recorded
/// by a previous install. Returns the new settings and the status line to
/// restore on uninstall.
pub fn install(
    settings: Value,
    bin: &str,
    with_statusline: bool,
    saved: Option<&Value>,
) -> (Value, Option<Value>) {
    let previous = match settings.get("statusLine") {
        Some(s) if s["command"].as_str().is_some_and(is_ours) => saved.cloned(),
        other => other.cloned(),
    }
    .filter(|s| !s.is_null());
    // Start from a clean slate so reinstalling updates paths instead of duplicating.
    let mut s = uninstall(settings, previous.as_ref());
    if !s.is_object() {
        s = json!({});
    }
    let obj = s.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    for e in EVENTS {
        let groups = hooks
            .as_object_mut()
            .unwrap()
            .entry(*e)
            .or_insert_with(|| json!([]));
        if !groups.is_array() {
            *groups = json!([]);
        }
        groups.as_array_mut().unwrap().push(json!({
            "hooks": [{ "type": "command", "command": hook_command(bin), "timeout": 5 }]
        }));
    }
    let mut kept = None;
    if with_statusline {
        let wrapped = previous
            .as_ref()
            .and_then(|p| p["command"].as_str())
            .map(str::to_owned);
        let mut line = previous
            .clone()
            .unwrap_or_else(|| json!({ "type": "command" }));
        line["type"] = json!("command");
        line["command"] = json!(statusline_command(bin, wrapped.as_deref()));
        obj.insert("statusLine".into(), line);
        kept = previous;
    }
    (s, kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIN: &str = "/Applications/Nacre.app/Contents/MacOS/nacre";

    fn user_settings() -> Value {
        json!({
            "model": "opus",
            "statusLine": { "type": "command", "command": "ccstatusline", "padding": 0, "refreshInterval": 10 },
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }]
            }
        })
    }

    #[test]
    fn install_preserves_and_wraps() {
        let (s, prev) = install(user_settings(), BIN, true, None);
        assert_eq!(s["model"], "opus");
        assert_eq!(prev.unwrap()["command"], "ccstatusline");
        let stop = s["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["hooks"][0]["command"], "say done");
        let line = &s["statusLine"];
        assert_eq!(line["refreshInterval"], 10);
        let cmd = line["command"].as_str().unwrap();
        assert!(cmd.contains("--wrap 'ccstatusline'"), "{cmd}");
        assert!(cmd.contains("|| ccstatusline"));
        let st = status(&s);
        assert!(st.hooks && st.statusline);
    }

    #[test]
    fn reinstall_is_idempotent() {
        let (once, prev) = install(user_settings(), BIN, true, None);
        // Second install sees our status line; the original comes from the first run.
        let (twice, prev2) = install(once.clone(), "/new/nacre", true, prev.as_ref());
        assert_eq!(prev2, prev);
        assert!(
            twice["statusLine"]["command"]
                .as_str()
                .unwrap()
                .contains("--wrap 'ccstatusline'")
        );
        assert_eq!(twice["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(
            twice["hooks"]["SessionStart"][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
                .contains("/new/nacre")
        );
        let restored = uninstall(twice, prev.as_ref());
        assert_eq!(restored, user_settings());
    }

    #[test]
    fn uninstall_restores_exactly() {
        let (s, prev) = install(user_settings(), BIN, true, None);
        assert_eq!(uninstall(s, prev.as_ref()), user_settings());
        let (s, prev) = install(json!({}), BIN, true, None);
        assert!(prev.is_none());
        assert_eq!(uninstall(s, None), json!({}));
    }

    #[test]
    fn hooks_only() {
        let (s, _) = install(user_settings(), BIN, false, None);
        assert_eq!(s["statusLine"]["command"], "ccstatusline");
        assert!(!status(&s).statusline);
    }

    #[test]
    fn quoting() {
        let c = hook_command("/Apps/It's/nacre");
        assert!(c.contains(r"'/Apps/It'\''s/nacre' claude-event"), "{c}");
    }
}
