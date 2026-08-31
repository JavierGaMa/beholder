use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::types::ConsoleError;

pub trait ShellSink: Send + Sync {
    fn bytes(&self, chunk: String);
    fn exit(&self, code: Option<u32>);
}

const READ_CHUNK: usize = 8 * 1024;
const WAIT_POLL: Duration = Duration::from_millis(50);

struct ShellInner {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    running: Arc<AtomicBool>,
}

impl ShellInner {
    fn kill_child(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }
}

impl Drop for ShellInner {
    fn drop(&mut self) {
        self.kill_child();
    }
}

#[derive(Clone)]
pub struct ShellHandle {
    inner: Arc<ShellInner>,
}

impl ShellHandle {
    pub fn input(&self, bytes: &[u8]) -> Result<(), ConsoleError> {
        let mut writer = self.inner.writer.lock().unwrap();
        writer
            .write_all(bytes)
            .and_then(|_| writer.flush())
            .map_err(|e| ConsoleError::Other(e.to_string()))
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let _ = self.inner.master.lock().unwrap().resize(size);
    }

    pub fn kill(&self) {
        self.inner.kill_child();
    }

    pub fn is_running(&self) -> bool {
        self.inner.running.load(Ordering::SeqCst)
    }
}

pub struct PtyShell;

impl PtyShell {
    pub fn spawn(
        cmd: CommandBuilder,
        rows: u16,
        cols: u16,
        sink: Arc<dyn ShellSink>,
    ) -> Result<ShellHandle, ConsoleError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| ConsoleError::Other(e.to_string()))?;
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| ConsoleError::Other(e.to_string()))?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| ConsoleError::Other(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| ConsoleError::Other(e.to_string()))?;

        let running = Arc::new(AtomicBool::new(true));
        let child = Arc::new(Mutex::new(Some(child)));

        let read_sink = sink.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; READ_CHUNK];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => read_sink.bytes(BASE64.encode(&buf[..n])),
                }
            }
        });

        let wait_child = child.clone();
        let wait_running = running.clone();
        std::thread::spawn(move || {
            let code = loop {
                let mut guard = wait_child.lock().unwrap();
                let Some(live) = guard.as_mut() else {
                    return;
                };
                match live.try_wait() {
                    Ok(Some(status)) => {
                        drop(guard);
                        wait_running.store(false, Ordering::SeqCst);
                        break Some(status.exit_code());
                    }
                    Ok(None) => {}
                    Err(_) => {
                        drop(guard);
                        wait_running.store(false, Ordering::SeqCst);
                        break None;
                    }
                }
                drop(guard);
                std::thread::sleep(WAIT_POLL);
            };
            sink.exit(code);
        });

        Ok(ShellHandle {
            inner: Arc::new(ShellInner {
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child,
                running,
            }),
        })
    }
}

pub fn adb_shell_command(adb_path: &Path, serial: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(adb_path);
    cmd.arg("-s");
    cmd.arg(serial);
    cmd.arg("shell");
    cmd.env("TERM", "xterm-256color");
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    struct RecordingShellSink {
        chunks: Mutex<Vec<String>>,
        exits: Mutex<Vec<Option<u32>>>,
    }

    impl RecordingShellSink {
        fn new() -> Arc<Self> {
            Arc::new(RecordingShellSink {
                chunks: Mutex::new(vec![]),
                exits: Mutex::new(vec![]),
            })
        }

        fn output(&self) -> Vec<u8> {
            let mut out = vec![];
            for chunk in self.chunks.lock().unwrap().iter() {
                out.extend_from_slice(&BASE64.decode(chunk).unwrap());
            }
            out
        }

        fn contains(&self, needle: &[u8]) -> bool {
            self.output()
                .windows(needle.len())
                .any(|w| w == needle)
        }

        fn exits(&self) -> Vec<Option<u32>> {
            self.exits.lock().unwrap().clone()
        }
    }

    impl ShellSink for RecordingShellSink {
        fn bytes(&self, chunk: String) {
            self.chunks.lock().unwrap().push(chunk);
        }

        fn exit(&self, code: Option<u32>) {
            self.exits.lock().unwrap().push(code);
        }
    }

    fn wait_for(timeout: Duration, f: impl Fn() -> bool) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn sh_cmd(script: &str) -> CommandBuilder {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg(script);
        cmd
    }

    #[test]
    fn adb_shell_command_builds_expected_argv() {
        let cmd = adb_shell_command(Path::new("/usr/bin/adb"), "emulator-5554");
        assert_eq!(
            cmd.get_argv(),
            &vec![
                OsString::from("/usr/bin/adb"),
                OsString::from("-s"),
                OsString::from("emulator-5554"),
                OsString::from("shell"),
            ]
        );
        assert_eq!(cmd.get_env("TERM"), Some(std::ffi::OsStr::new("xterm-256color")));
    }

    #[cfg(unix)]
    #[test]
    fn round_trips_output_input_and_kill() {
        let sink = RecordingShellSink::new();
        let handle = PtyShell::spawn(sh_cmd("echo hello; cat"), 24, 80, sink.clone()).unwrap();
        assert!(handle.is_running());
        assert!(
            wait_for(Duration::from_secs(5), || sink.contains(b"hello")),
            "expected hello in output, got {:?}",
            String::from_utf8_lossy(&sink.output())
        );
        handle.input(b"world\n").unwrap();
        assert!(
            wait_for(Duration::from_secs(5), || sink.contains(b"world")),
            "expected echoed input in output, got {:?}",
            String::from_utf8_lossy(&sink.output())
        );
        handle.kill();
        assert!(wait_for(Duration::from_secs(5), || !handle.is_running()));
        let exits = sink.exits();
        assert_eq!(exits.len(), 1);
        assert!(exits[0].is_some());
    }

    #[cfg(unix)]
    #[test]
    fn reports_clean_exit_code() {
        let sink = RecordingShellSink::new();
        let handle = PtyShell::spawn(sh_cmd("exit 0"), 24, 80, sink.clone()).unwrap();
        assert!(wait_for(Duration::from_secs(5), || !handle.is_running()));
        assert_eq!(sink.exits(), vec![Some(0)]);
    }

    #[cfg(unix)]
    #[test]
    fn reports_nonzero_exit_code() {
        let sink = RecordingShellSink::new();
        let handle = PtyShell::spawn(sh_cmd("exit 3"), 24, 80, sink.clone()).unwrap();
        assert!(wait_for(Duration::from_secs(5), || !handle.is_running()));
        assert_eq!(sink.exits(), vec![Some(3)]);
    }

    #[cfg(unix)]
    #[test]
    fn input_after_exit_errors() {
        let sink = RecordingShellSink::new();
        let handle = PtyShell::spawn(sh_cmd("exit 0"), 24, 80, sink.clone()).unwrap();
        assert!(wait_for(Duration::from_secs(5), || !handle.is_running()));
        assert!(handle.input(b"x\n").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn resize_keeps_shell_alive_and_writable() {
        let sink = RecordingShellSink::new();
        let handle = PtyShell::spawn(sh_cmd("cat"), 24, 80, sink.clone()).unwrap();
        handle.resize(40, 120);
        handle.input(b"ping\n").unwrap();
        assert!(
            wait_for(Duration::from_secs(5), || sink.contains(b"ping")),
            "expected echoed input after resize, got {:?}",
            String::from_utf8_lossy(&sink.output())
        );
        assert!(handle.is_running());
        handle.kill();
        assert!(wait_for(Duration::from_secs(5), || !handle.is_running()));
    }
}
