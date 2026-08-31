use crate::types::{ConsoleError, ConsoleEvent, LogBuffer};
use std::collections::{VecDeque};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::Mutex;

pub trait LogStream: Send {
    fn lines(&mut self) -> Option<String>;
}

pub trait LogStreamFactory: Send + Sync {
    fn open(&self, serial: &str, buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError>;
}

pub trait ConsoleSink: Send + Sync {
    fn emit(&self, event: ConsoleEvent);
}

fn buffer_names(buffers: &[LogBuffer]) -> Vec<&'static str> {
    if buffers.is_empty() {
        vec!["main", "system", "crash"]
    } else {
        buffers.iter().map(|b| b.as_str()).collect()
    }
}

fn logcat_args(serial: &str, buffers: &[LogBuffer]) -> Vec<String> {
    vec![
        "-s".into(),
        serial.into(),
        "logcat".into(),
        "-v".into(),
        "threadtime".into(),
        "-b".into(),
        buffer_names(buffers).join(","),
    ]
}

pub struct AdbLogcatFactory {
    adb_path: PathBuf,
}

impl AdbLogcatFactory {
    pub fn new(adb_path: impl Into<PathBuf>) -> Self {
        AdbLogcatFactory {
            adb_path: adb_path.into(),
        }
    }
}

impl LogStreamFactory for AdbLogcatFactory {
    fn open(&self, serial: &str, buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError> {
        let child = Command::new(&self.adb_path)
            .args(logcat_args(serial, buffers))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => {
                    ConsoleError::AdbNotFound(self.adb_path.display().to_string())
                }
                _ => ConsoleError::Other(e.to_string()),
            })?;
        Ok(Box::new(AdbLogcatStream::new(child)?))
    }
}

pub struct AdbLogcatStream {
    reader: BufReader<ChildStdout>,
    child: Child,
}

impl AdbLogcatStream {
    fn new(mut child: Child) -> Result<Self, ConsoleError> {
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ConsoleError::Other("adb logcat produced no stdout".into()))?;
        Ok(AdbLogcatStream {
            reader: BufReader::new(stdout),
            child,
        })
    }
}

impl Drop for AdbLogcatStream {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl LogStream for AdbLogcatStream {
    fn lines(&mut self) -> Option<String> {
        let mut buf = String::new();
        match self.reader.read_line(&mut buf) {
            Ok(0) => None,
            Ok(_) => {
                while buf.ends_with('\n') || buf.ends_with('\r') {
                    buf.pop();
                }
                Some(buf)
            }
            Err(_) => None,
        }
    }
}

pub struct FakeLogStream {
    lines: VecDeque<String>,
}

impl FakeLogStream {
    pub fn new<I: IntoIterator<Item = String>>(lines: I) -> Self {
        FakeLogStream {
            lines: lines.into_iter().collect(),
        }
    }
}

impl LogStream for FakeLogStream {
    fn lines(&mut self) -> Option<String> {
        self.lines.pop_front()
    }
}

pub struct FakeLogStreamFactory {
    pub opens: Mutex<Vec<(String, Vec<LogBuffer>)>>,
    pub streams: Mutex<VecDeque<Result<Vec<String>, ConsoleError>>>,
}

impl FakeLogStreamFactory {
    pub fn new() -> Self {
        FakeLogStreamFactory {
            opens: Mutex::new(vec![]),
            streams: Mutex::new(VecDeque::new()),
        }
    }

    pub fn push_lines(&self, lines: Vec<&str>) {
        self.streams.lock().unwrap().push_back(Ok(lines
            .into_iter()
            .map(|l| l.to_string())
            .collect()));
    }

    pub fn push_error(&self, err: ConsoleError) {
        self.streams.lock().unwrap().push_back(Err(err));
    }

    pub fn open_count(&self) -> usize {
        self.opens.lock().unwrap().len()
    }
}

impl Default for FakeLogStreamFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl LogStreamFactory for FakeLogStreamFactory {
    fn open(&self, serial: &str, buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError> {
        self.opens
            .lock()
            .unwrap()
            .push((serial.to_string(), buffers.to_vec()));
        self.streams
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Err(ConsoleError::Other("no scripted stream".into())))
            .map(|lines| Box::new(FakeLogStream::new(lines)) as Box<dyn LogStream>)
    }
}

#[derive(Default)]
pub struct RecordingConsoleSink {
    pub events: Mutex<Vec<ConsoleEvent>>,
}

impl RecordingConsoleSink {
    pub fn new() -> Self {
        RecordingConsoleSink {
            events: Mutex::new(vec![]),
        }
    }
}

impl ConsoleSink for RecordingConsoleSink {
    fn emit(&self, event: ConsoleEvent) {
        self.events.lock().unwrap().push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_expected_adb_args() {
        let args = logcat_args(
            "emulator-5554",
            &[LogBuffer::Main, LogBuffer::System, LogBuffer::Crash],
        );
        assert_eq!(
            args,
            vec![
                "-s",
                "emulator-5554",
                "logcat",
                "-v",
                "threadtime",
                "-b",
                "main,system,crash"
            ]
        );
    }

    #[test]
    fn default_buffers_cover_main_system_crash() {
        let args = logcat_args("emu", &[]);
        assert_eq!(args.last().unwrap(), "main,system,crash");
        let args = logcat_args("emu", &[LogBuffer::Radio]);
        assert_eq!(args.last().unwrap(), "radio");
    }

    #[test]
    fn factory_records_open_calls() {
        let factory = FakeLogStreamFactory::new();
        factory.push_lines(vec!["08-28 11:00:00.100  1  1 I Tag: m"]);
        let mut stream = factory
            .open("emulator-5554", &[LogBuffer::Main])
            .unwrap();
        assert_eq!(
            factory.opens.lock().unwrap()[0],
            ("emulator-5554".to_string(), vec![LogBuffer::Main])
        );
        assert_eq!(stream.lines().as_deref(), Some("08-28 11:00:00.100  1  1 I Tag: m"));
        assert_eq!(stream.lines(), None);
    }
}
