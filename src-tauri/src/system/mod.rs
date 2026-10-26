//! Data for status bar segments: system load, git, project tools, custom scripts.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Networks, System};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub battery: Option<u8>,
    pub charging: bool,
    pub net_rx: u64,
    pub net_tx: u64,
}

pub struct SystemMonitor {
    inner: Mutex<Inner>,
}

struct Inner {
    sys: System,
    nets: Networks,
    last_net: Instant,
    battery: (Option<u8>, bool),
    battery_at: Option<Instant>,
}

impl Default for SystemMonitor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                sys: System::new(),
                nets: Networks::new_with_refreshed_list(),
                last_net: Instant::now(),
                battery: (None, false),
                battery_at: None,
            }),
        }
    }
}

impl SystemMonitor {
    pub fn stats(&self) -> Stats {
        let mut s = self.inner.lock().unwrap();
        s.sys.refresh_cpu_usage();
        s.sys.refresh_memory();
        let elapsed = s.last_net.elapsed().as_secs_f64().max(0.001);
        s.nets.refresh(true);
        s.last_net = Instant::now();
        let (rx, tx) = s
            .nets
            .iter()
            .filter(|(name, _)| !name.starts_with("lo"))
            .fold((0, 0), |(r, t), (_, n)| {
                (r + n.received(), t + n.transmitted())
            });
        if s.battery_at
            .is_none_or(|t| t.elapsed() > Duration::from_secs(30))
        {
            s.battery = battery();
            s.battery_at = Some(Instant::now());
        }
        Stats {
            cpu: s.sys.global_cpu_usage(),
            mem_used: s.sys.used_memory(),
            mem_total: s.sys.total_memory(),
            battery: s.battery.0,
            charging: s.battery.1,
            net_rx: (rx as f64 / elapsed) as u64,
            net_tx: (tx as f64 / elapsed) as u64,
        }
    }
}

#[cfg(target_os = "macos")]
fn battery() -> (Option<u8>, bool) {
    let Ok(out) = Command::new("pmset").args(["-g", "batt"]).output() else {
        return (None, false);
    };
    parse_pmset(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(target_os = "macos"))]
fn battery() -> (Option<u8>, bool) {
    (None, false)
}

pub fn parse_pmset(text: &str) -> (Option<u8>, bool) {
    let Some(line) = text.lines().find(|l| l.contains("InternalBattery")) else {
        return (None, false);
    };
    let pct = line
        .split(['\t', ' ', ';'])
        .find_map(|w| w.strip_suffix('%'))
        .and_then(|p| p.parse().ok());
    let charging = line.contains("; charging") || line.contains("AC attached");
    (pct, charging)
}

/// Runs a command with a timeout; returns trimmed stdout on success.
pub fn run(cmd: &mut Command, timeout: Duration) -> Option<String> {
    run_with(cmd, timeout, &[0])
}

/// Like `run`, accepting any of `ok_codes` (e.g. `diff` exits 1 when files differ).
pub fn run_with(cmd: &mut Command, timeout: Duration, ok_codes: &[i32]) -> Option<String> {
    use std::io::Read;
    use std::os::unix::process::CommandExt;
    let mut child = cmd
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // Drain stdout concurrently so a large output cannot block the child.
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                // Kill the whole group so grandchildren release the pipe.
                unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
                let _ = child.wait();
                break None;
            }
        }
    };
    let out = reader.join().ok()?;
    status
        .filter(|s| s.code().is_some_and(|c| ok_codes.contains(&c)))
        .map(|_| out.trim_end().to_owned())
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub detached: bool,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
    pub conflicts: u32,
}

pub fn git_status(cwd: &str) -> Option<GitStatus> {
    let out = run(
        Command::new("git")
            .args([
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
            ])
            .current_dir(cwd),
        Duration::from_secs(3),
    )?;
    Some(parse_git(&out))
}

pub fn parse_git(out: &str) -> GitStatus {
    let mut g = GitStatus::default();
    let mut oid = String::new();
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            g.branch = head.to_owned();
        } else if let Some(o) = line.strip_prefix("# branch.oid ") {
            oid = o.chars().take(7).collect();
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(a) = part.strip_prefix('+') {
                    g.ahead = a.parse().unwrap_or(0);
                } else if let Some(b) = part.strip_prefix('-') {
                    g.behind = b.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let xy: Vec<char> = line[2..4].chars().collect();
            if xy[0] != '.' {
                g.staged += 1;
            }
            if xy[1] != '.' {
                g.modified += 1;
            }
        } else if line.starts_with("u ") {
            g.conflicts += 1;
        } else if line.starts_with("? ") {
            g.untracked += 1;
        }
    }
    if g.branch == "(detached)" {
        g.detached = true;
        g.branch = oid;
    }
    g
}

#[derive(Debug, Clone, Serialize)]
pub struct Tool {
    pub name: &'static str,
    pub version: String,
}

const TOOLS: &[(&str, &[&str], &str, &[&str])] = &[
    (
        "node",
        &["package.json", ".nvmrc", ".node-version"],
        "node",
        &["--version"],
    ),
    (
        "python",
        &[
            "pyproject.toml",
            "requirements.txt",
            "setup.py",
            ".python-version",
        ],
        "python3",
        &["--version"],
    ),
    (
        "rust",
        &["Cargo.toml", "rust-toolchain.toml"],
        "rustc",
        &["--version"],
    ),
    ("go", &["go.mod"], "go", &["version"]),
    (
        "ruby",
        &["Gemfile", ".ruby-version"],
        "ruby",
        &["--version"],
    ),
    (
        "java",
        &["pom.xml", "build.gradle", "build.gradle.kts"],
        "java",
        &["--version"],
    ),
    ("deno", &["deno.json", "deno.jsonc"], "deno", &["--version"]),
    ("bun", &["bun.lockb", "bun.lock"], "bun", &["--version"]),
];

/// (binary, project dir) → (checked at, version)
type VersionMap = HashMap<(String, String), (Instant, Option<String>)>;

#[derive(Default)]
pub struct ToolCache {
    versions: Mutex<VersionMap>,
}

pub fn extract_version(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == ',')
        .map(|w| w.trim_start_matches(['v', 'V']).trim_start_matches("go"))
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(str::to_owned)
}

impl ToolCache {
    /// Versions of the toolchains a project uses, found by walking up for marker files.
    pub fn project_tools(&self, cwd: &str) -> Vec<Tool> {
        let mut found = Vec::new();
        for (name, markers, bin, args) in TOOLS {
            let mut dir = Some(Path::new(cwd));
            let mut hit = None;
            while let Some(d) = dir {
                if markers.iter().any(|m| d.join(m).exists()) {
                    hit = Some(d.to_path_buf());
                    break;
                }
                if d.join(".git").exists() {
                    break;
                }
                dir = d.parent();
            }
            let Some(project) = hit else { continue };
            let key = (bin.to_string(), project.to_string_lossy().into_owned());
            let cached = self.versions.lock().unwrap().get(&key).cloned();
            let version = match cached {
                Some((at, v)) if at.elapsed() < Duration::from_secs(60) => v,
                _ => {
                    let v = run(
                        Command::new(bin).args(*args).current_dir(&project),
                        Duration::from_secs(3),
                    )
                    .and_then(|o| extract_version(&o));
                    self.versions
                        .lock()
                        .unwrap()
                        .insert(key, (Instant::now(), v.clone()));
                    v
                }
            };
            if let Some(version) = version {
                found.push(Tool { name, version });
            }
        }
        found
    }
}

/// First line of a user script's output, run in the pane's directory.
pub fn run_script(command: &str, cwd: Option<&str>, timeout_ms: u64) -> Option<String> {
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", command]);
    if let Some(c) = cwd.filter(|c| Path::new(c).is_dir()) {
        cmd.current_dir(c);
    }
    run(&mut cmd, Duration::from_millis(timeout_ms))
        .map(|o| o.lines().next().unwrap_or("").to_owned())
}

/// `current-context` from kubeconfig, without a YAML parser.
pub fn kube_context() -> Option<String> {
    let path = std::env::var_os("KUBECONFIG")
        .map(|p| {
            p.to_string_lossy()
                .split(':')
                .next()
                .unwrap_or("")
                .to_owned()
        })
        .filter(|p| !p.is_empty())
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| format!("{h}/.kube/config"))
        })?;
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix("current-context:"))
        .map(|v| v.trim().trim_matches('"').to_owned())
        .filter(|v| !v.is_empty())
}

pub fn docker_context() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let text = std::fs::read_to_string(format!("{home}/.docker/config.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v["currentContext"]
        .as_str()
        .filter(|c| *c != "default")
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pmset() {
        let t = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t87%; discharging; 4:12 remaining present: true";
        assert_eq!(parse_pmset(t), (Some(87), false));
        let t =
            " -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\nAC attached";
        assert_eq!(parse_pmset(t).0, Some(100));
        assert_eq!(parse_pmset("Now drawing from 'AC Power'"), (None, false));
    }

    #[test]
    fn git_porcelain() {
        let out = "# branch.oid 1234567890\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x\n1 M. N... 100644 100644 100644 a b src/y\n? new.txt\nu UU N... 1 2 3 4 a b c f";
        let g = parse_git(out);
        assert_eq!(g.branch, "main");
        assert_eq!((g.ahead, g.behind), (2, 1));
        assert_eq!(
            (g.staged, g.modified, g.untracked, g.conflicts),
            (1, 1, 1, 1)
        );
        let d = parse_git("# branch.oid abcdef123456\n# branch.head (detached)\n");
        assert!(d.detached);
        assert_eq!(d.branch, "abcdef1");
    }

    #[test]
    fn versions() {
        assert_eq!(extract_version("v20.11.1").as_deref(), Some("20.11.1"));
        assert_eq!(extract_version("Python 3.12.2").as_deref(), Some("3.12.2"));
        assert_eq!(
            extract_version("rustc 1.99.1 (58cf8f9c3 2026-10-13)").as_deref(),
            Some("1.99.1")
        );
        assert_eq!(
            extract_version("go version go1.22.1 darwin/arm64").as_deref(),
            Some("1.22.1")
        );
    }

    #[test]
    fn script_timeout() {
        assert_eq!(
            run_script("echo hi; echo there", None, 2000).as_deref(),
            Some("hi")
        );
        assert_eq!(run_script("sleep 2", None, 100), None);
        let t = Instant::now();
        assert_eq!(run_script("sleep 3; echo x", None, 100), None);
        assert!(t.elapsed() < Duration::from_secs(1));
    }
}

#[cfg(test)]
mod live {
    #[test]
    fn git_here() {
        let dir = env!("CARGO_MANIFEST_DIR");
        let g = super::git_status(dir);
        assert!(g.is_some_and(|g| !g.branch.is_empty()));
    }
}
