use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogLevel {
    Verbose,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl LogLevel {
    pub fn rank(&self) -> u8 {
        match self {
            LogLevel::Verbose => 0,
            LogLevel::Debug => 1,
            LogLevel::Info => 2,
            LogLevel::Warn => 3,
            LogLevel::Error => 4,
            LogLevel::Fatal => 5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogBuffer {
    Main,
    System,
    Crash,
    Radio,
    Events,
}

impl LogBuffer {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogBuffer::Main => "main",
            LogBuffer::System => "system",
            LogBuffer::Crash => "crash",
            LogBuffer::Radio => "radio",
            LogBuffer::Events => "events",
        }
    }
}

impl std::str::FromStr for LogBuffer {
    type Err = ConsoleError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "main" => Ok(LogBuffer::Main),
            "system" => Ok(LogBuffer::System),
            "crash" => Ok(LogBuffer::Crash),
            "radio" => Ok(LogBuffer::Radio),
            "events" => Ok(LogBuffer::Events),
            other => Err(ConsoleError::Other(format!("unknown buffer: {other}"))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogLine {
    pub ts_ms: u64,
    pub level: LogLevel,
    pub pid: u32,
    pub tid: u32,
    pub tag: String,
    pub buffer: LogBuffer,
    pub message: String,
    pub is_crash: bool,
    pub repeat_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LogStatus {
    Streaming,
    Disconnected,
    Failed(String),
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ConsoleEvent {
    Line(LogLine),
    Status(LogStatus),
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LogFilter {
    pub pid: Option<u32>,
    pub min_level: Option<LogLevel>,
    pub tags: Vec<String>,
}

#[derive(Debug, Error)]
pub enum ConsoleError {
    #[error("adb not found: {0}")]
    AdbNotFound(String),
    #[error("command failed ({program} {args:?}): {stderr}")]
    CommandFailed {
        program: String,
        args: Vec<String>,
        stderr: String,
    },
    #[error("{0}")]
    Other(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logline_serializes_snake_case() {
        let line = LogLine {
            ts_ms: 42,
            level: LogLevel::Warn,
            pid: 7,
            tid: 8,
            tag: "ReactNativeJS".into(),
            buffer: LogBuffer::Crash,
            message: "boom".into(),
            is_crash: true,
            repeat_count: 3,
        };
        let v = serde_json::to_value(&line).unwrap();
        assert_eq!(v["ts_ms"], 42);
        assert_eq!(v["repeat_count"], 3);
        assert_eq!(v["is_crash"], true);
        assert_eq!(v["level"], "Warn");
        assert_eq!(v["buffer"], "Crash");
    }

    #[test]
    fn log_filter_deserializes_partial_payloads() {
        let v: LogFilter = serde_json::from_str("{}").unwrap();
        assert_eq!(v, LogFilter::default());
        let v: LogFilter = serde_json::from_str(r#"{"pid": 4521}"#).unwrap();
        assert_eq!(v.pid, Some(4521));
        assert!(v.tags.is_empty());
        let v: LogFilter =
            serde_json::from_str(r#"{"min_level": "Error", "tags": ["ReactNativeJS"]}"#).unwrap();
        assert_eq!(v.min_level, Some(LogLevel::Error));
        assert_eq!(v.tags, vec!["ReactNativeJS".to_string()]);
    }
}
