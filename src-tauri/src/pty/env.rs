use std::ffi::CStr;
use std::path::PathBuf;

use portable_pty::CommandBuilder;

use super::SpawnOptions;

/// Variables from a parent terminal or Claude Code session that would mislead programs in Nacre.
const STRIPPED: &[&str] = &[
    "TERM_SESSION_ID",
    "ITERM_SESSION_ID",
    "ITERM_PROFILE",
    "KITTY_WINDOW_ID",
    "WEZTERM_PANE",
    "ALACRITTY_WINDOW_ID",
    "GHOSTTY_RESOURCES_DIR",
    "VSCODE_INJECTION",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
];

pub fn resolve_shell(requested: Option<&str>) -> String {
    requested
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(default_shell)
}

pub fn default_shell() -> String {
    // The account's login shell wins over $SHELL, which may be stale in GUI launches.
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if !pw.is_null()
            && !(*pw).pw_shell.is_null()
            && let Ok(s) = CStr::from_ptr((*pw).pw_shell).to_str()
            && !s.is_empty()
        {
            return s.to_owned();
        }
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

pub fn build_command(
    opts: &SpawnOptions,
    cwd: Option<PathBuf>,
    pane_id: &str,
    extra_env: Vec<(String, String)>,
) -> CommandBuilder {
    let shell = opts
        .shell
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(&shell);
    let interactive: Vec<String> = opts
        .args
        .clone()
        .or_else(|| opts.interactive_args.clone())
        .unwrap_or_else(|| vec!["-l".into()]);
    match opts.command.as_deref().filter(|c| !c.trim().is_empty()) {
        Some(command) => {
            // Run the startup command, then stay in an interactive shell.
            let rest: Vec<String> = interactive.iter().map(|a| shell_quote(a)).collect();
            cmd.args(["-l", "-c"]);
            cmd.arg(format!(
                "{command}; exec {} {}",
                shell_quote(&shell),
                rest.join(" ")
            ));
        }
        None => cmd.args(&interactive),
    }
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
    }
    for key in STRIPPED {
        cmd.env_remove(key);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Nacre");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    cmd.env("NACRE", "1");
    cmd.env("NACRE_PANE_ID", pane_id);
    if cmd.get_env("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    if let Some(env) = &opts.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }
    cmd
}

pub fn shell_quote(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "/._-+=:,@%".contains(c))
    {
        s.to_owned()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(shell_quote("/bin/zsh"), "/bin/zsh");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn sets_terminal_env() {
        let opts = SpawnOptions {
            cols: 80,
            rows: 24,
            shell: Some("/bin/sh".into()),
            ..Default::default()
        };
        let cmd = build_command(
            &opts,
            None,
            "p1",
            vec![("NACRE_SOCKET".into(), "/s".into())],
        );
        assert_eq!(cmd.get_env("TERM").unwrap(), "xterm-256color");
        assert_eq!(cmd.get_env("NACRE_PANE_ID").unwrap(), "p1");
        assert_eq!(cmd.get_env("NACRE_SOCKET").unwrap(), "/s");
        assert!(cmd.get_env("CLAUDECODE").is_none());
    }
}
