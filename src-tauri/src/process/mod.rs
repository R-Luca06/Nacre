use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    /// Display name, e.g. `vim`, `claude`.
    pub name: String,
    pub cwd: Option<String>,
    /// True when the shell itself is in the foreground (nothing running).
    pub is_shell: bool,
}

pub struct ProcessInspector {
    sys: Mutex<System>,
}

impl Default for ProcessInspector {
    fn default() -> Self {
        Self {
            sys: Mutex::new(System::new()),
        }
    }
}

impl ProcessInspector {
    pub fn inspect(&self, shell_pid: Option<u32>, fg_pid: Option<u32>) -> Option<ProcInfo> {
        let pid = fg_pid.or(shell_pid)?;
        let mut sys = self.sys.lock().unwrap();
        let pids = [Pid::from_u32(pid)];
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing()
                .with_cwd(UpdateKind::Always)
                .with_cmd(UpdateKind::Always)
                .with_exe(UpdateKind::OnlyIfNotSet),
        );
        let p = sys.process(pids[0])?;
        let cmd: Vec<String> = p
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        let exe = p.exe().map(|e| e.to_string_lossy().into_owned());
        Some(ProcInfo {
            pid,
            name: display_name(&p.name().to_string_lossy(), exe.as_deref(), &cmd),
            cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
            is_shell: Some(pid) == shell_pid,
        })
    }
}

const INTERPRETERS: &[&str] = &["node", "bun", "deno", "python", "python3", "ruby", "perl"];

/// Interpreters hide the real program: `node /…/bin/claude` should read as `claude`.
pub fn display_name(name: &str, exe: Option<&str>, cmd: &[String]) -> String {
    let base = exe
        .and_then(|e| Path::new(e).file_name())
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_owned());
    let base = base.trim_start_matches('-').to_owned();
    let is_interp = INTERPRETERS
        .iter()
        .any(|i| base == *i || base.starts_with(&format!("{i}.")));
    if is_interp
        && let Some(script) = cmd.iter().skip(1).find(|a| !a.starts_with('-'))
        && let Some(f) = Path::new(script).file_name()
    {
        let f = f.to_string_lossy();
        let f = f
            .strip_suffix(".js")
            .or_else(|| f.strip_suffix(".mjs"))
            .or_else(|| f.strip_suffix(".py"))
            .unwrap_or(&f);
        // e.g. …/@anthropic-ai/claude-code/cli.js
        if f == "cli" && script.contains("claude-code") {
            return "claude".into();
        }
        return f.to_owned();
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn plain_binary() {
        assert_eq!(
            display_name("vim", Some("/usr/bin/vim"), &s(&["vim"])),
            "vim"
        );
        assert_eq!(display_name("-zsh", None, &s(&["-zsh"])), "zsh");
    }

    #[test]
    fn interpreted_scripts() {
        assert_eq!(
            display_name(
                "node",
                Some("/opt/homebrew/bin/node"),
                &s(&[
                    "node",
                    "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"
                ])
            ),
            "claude"
        );
        assert_eq!(
            display_name("node", None, &s(&["node", "--inspect", "/x/bin/claude"])),
            "claude"
        );
        assert_eq!(
            display_name("python3.12", None, &s(&["python3.12", "manage.py"])),
            "manage"
        );
        assert_eq!(display_name("node", None, &s(&["node"])), "node");
    }
}
