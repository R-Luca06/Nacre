//! Writes the shell scripts in `shell/` to the app data dir and tells each
//! shell how to load them without editing the user's dotfiles.

use std::path::{Path, PathBuf};

const FILES: &[(&str, &str)] = &[
    ("nacre.zsh", include_str!("../../../shell/nacre.zsh")),
    ("zsh/.zshenv", include_str!("../../../shell/zsh/.zshenv")),
    ("nacre.bash", include_str!("../../../shell/nacre.bash")),
    (
        "fish/vendor_conf.d/nacre.fish",
        include_str!("../../../shell/fish/vendor_conf.d/nacre.fish"),
    ),
];

pub fn install(dir: &Path) -> std::io::Result<()> {
    for (rel, text) in FILES {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if std::fs::read_to_string(&path).ok().as_deref() != Some(*text) {
            std::fs::write(&path, text)?;
        }
    }
    Ok(())
}

pub struct Injection {
    pub env: Vec<(String, String)>,
    /// Replaces the default `-l` when set.
    pub args: Option<Vec<String>>,
}

/// How to start `shell` with the integration loaded.
pub fn injection(dir: &Path, shell: &str) -> Option<Injection> {
    let name = Path::new(shell).file_name()?.to_string_lossy().into_owned();
    let d = dir.to_string_lossy().into_owned();
    let mut env = vec![("NACRE_SHELL_DIR".to_string(), d.clone())];
    match name.trim_start_matches('-') {
        "zsh" => {
            if let Ok(z) = std::env::var("ZDOTDIR") {
                env.push(("NACRE_USER_ZDOTDIR".into(), z));
            }
            env.push(("ZDOTDIR".into(), format!("{d}/zsh")));
            Some(Injection { env, args: None })
        }
        "bash" => Some(Injection {
            env,
            args: Some(vec![
                "--rcfile".into(),
                format!("{d}/nacre.bash"),
                "-i".into(),
            ]),
        }),
        "fish" => {
            let base = std::env::var("XDG_DATA_DIRS")
                .unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
            env.push(("XDG_DATA_DIRS".into(), format!("{d}:{base}")));
            Some(Injection { env, args: None })
        }
        _ => None,
    }
}

pub fn default_dir(data_dir: PathBuf) -> PathBuf {
    data_dir.join("shell")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injections() {
        let d = Path::new("/data/shell");
        let z = injection(d, "/bin/zsh").unwrap();
        assert!(
            z.env
                .contains(&("ZDOTDIR".into(), "/data/shell/zsh".into()))
        );
        let b = injection(d, "/opt/homebrew/bin/bash").unwrap();
        assert_eq!(b.args.unwrap()[1], "/data/shell/nacre.bash");
        let f = injection(d, "/usr/local/bin/fish").unwrap();
        assert!(
            f.env
                .iter()
                .any(|(k, v)| k == "XDG_DATA_DIRS" && v.starts_with("/data/shell:"))
        );
        assert!(injection(d, "/bin/tcsh").is_none());
    }

    #[test]
    fn writes_files() {
        let dir = std::env::temp_dir().join(format!("nacre-shell-test-{}", std::process::id()));
        install(&dir).unwrap();
        assert!(dir.join("zsh/.zshenv").exists());
        assert!(dir.join("fish/vendor_conf.d/nacre.fish").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
