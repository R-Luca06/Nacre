//! Output kept on disk past the in-memory scrollback: colors only, other escapes dropped.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A log file rotates to `.1` past this size, so a pane keeps at most twice as much.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Default, PartialEq)]
enum State {
    #[default]
    Text,
    Esc,
    Csi,
    Osc,
    OscEsc,
}

/// Streaming filter; a sequence split across reads is handled.
#[derive(Default)]
pub struct Plain {
    state: State,
    csi: Vec<u8>,
}

impl Plain {
    pub fn filter(&mut self, input: &[u8], out: &mut Vec<u8>) {
        // A backspace never erases past a newline or a color change.
        let mut guard = out.len();
        for &b in input {
            match self.state {
                State::Text => match b {
                    0x1b => self.state = State::Esc,
                    b'\n' => {
                        out.push(b);
                        guard = out.len();
                    }
                    b'\t' => out.push(b),
                    // Line editors redraw with backspaces: apply them within this chunk.
                    0x08 => {
                        if out.len() > guard {
                            out.pop();
                        }
                    }
                    0x00..=0x1f | 0x7f => {}
                    _ => out.push(b),
                },
                State::Esc => {
                    self.state = match b {
                        b'[' => {
                            self.csi.clear();
                            State::Csi
                        }
                        b']' | b'P' | b'_' | b'^' => State::Osc,
                        _ => State::Text,
                    }
                }
                State::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        if b == b'm' {
                            out.extend_from_slice(b"\x1b[");
                            out.extend_from_slice(&self.csi);
                            out.push(b'm');
                            guard = out.len();
                        }
                        self.state = State::Text;
                    } else if self.csi.len() < 64 {
                        self.csi.push(b);
                    }
                }
                State::Osc => match b {
                    0x07 => self.state = State::Text,
                    0x1b => self.state = State::OscEsc,
                    _ => {}
                },
                State::OscEsc => self.state = if b == b'\\' { State::Text } else { State::Osc },
            }
        }
    }
}

pub struct Log {
    path: PathBuf,
    file: BufWriter<File>,
    size: u64,
    plain: Plain,
    buf: Vec<u8>,
    flushed: Instant,
}

impl Log {
    pub fn open(path: PathBuf) -> std::io::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            path,
            file: BufWriter::new(file),
            size,
            plain: Plain::default(),
            buf: Vec::new(),
            flushed: Instant::now(),
        })
    }

    /// `caught_up`: the read did not fill the buffer, so output paused; write it out now.
    pub fn write(&mut self, data: &[u8], caught_up: bool) {
        self.buf.clear();
        self.plain.filter(data, &mut self.buf);
        if self.file.write_all(&self.buf).is_err() {
            return;
        }
        self.size += self.buf.len() as u64;
        if self.size > MAX_BYTES {
            let _ = self.file.flush();
            let _ = std::fs::rename(&self.path, rotated(&self.path));
            if let Ok(f) = File::create(&self.path) {
                self.file = BufWriter::new(f);
                self.size = 0;
            }
        } else if caught_up || self.flushed.elapsed() > Duration::from_secs(1) {
            let _ = self.file.flush();
            self.flushed = Instant::now();
        }
    }
}

pub fn rotated(path: &Path) -> PathBuf {
    path.with_extension("log.1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_colors_drops_the_rest() {
        let mut p = Plain::default();
        let mut out = Vec::new();
        p.filter(
            b"\x1b]133;A\x07\x1b[31mred\x1b[0m\r\n\x1b[2Kok\x1b[",
            &mut out,
        );
        p.filter(b"1mbold\x1b]0;title\x1b\\\tend", &mut out);
        assert_eq!(out, b"\x1b[31mred\x1b[0m\nok\x1b[1mbold\tend");
        let mut out = Vec::new();
        p.filter(b"s\x08seq\nm\x08\x08", &mut out);
        assert_eq!(out, b"seq\n");
    }
}
