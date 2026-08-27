use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DeviceError {
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

#[derive(Debug, Clone, PartialEq)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub trait CommandRunner: Send + Sync {
    fn run(&self, args: &[&str]) -> Result<Output, DeviceError>;
}

pub struct RealRunner {
    adb_path: PathBuf,
}

impl RealRunner {
    pub fn discover() -> Result<Self, DeviceError> {
        let candidates = [
            std::env::var("ANDROID_HOME")
                .ok()
                .map(|h| PathBuf::from(h).join("platform-tools/adb")),
            std::env::var("ANDROID_SDK_ROOT")
                .ok()
                .map(|h| PathBuf::from(h).join("platform-tools/adb")),
            which_adb(),
            Some(PathBuf::from(format!(
                "{}/Library/Android/sdk/platform-tools/adb",
                std::env::var("HOME").unwrap_or_default()
            ))),
        ];
        let found = candidates
            .into_iter()
            .flatten()
            .find(|p| p.exists())
            .ok_or_else(|| {
                DeviceError::AdbNotFound(
                    "adb not found: install Android Studio platform-tools or set ANDROID_HOME"
                        .into(),
                )
            })?;
        Ok(RealRunner { adb_path: found })
    }

    pub fn adb_path(&self) -> &PathBuf {
        &self.adb_path
    }
}

fn which_adb() -> Option<PathBuf> {
    let out = Command::new("which").arg("adb").output().ok()?;
    if out.status.success() {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    None
}

impl CommandRunner for RealRunner {
    fn run(&self, args: &[&str]) -> Result<Output, DeviceError> {
        let out = Command::new(&self.adb_path)
            .args(args)
            .output()
            .map_err(|e| DeviceError::Other(e.to_string()))?;
        Ok(Output {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            success: out.status.success(),
        })
    }
}

pub struct FakeRunner {
    pub calls: std::sync::Mutex<Vec<Vec<String>>>,
    pub responses: std::sync::Mutex<VecDeque<Result<Output, DeviceError>>>,
}

impl FakeRunner {
    pub fn new() -> Self {
        FakeRunner {
            calls: std::sync::Mutex::new(vec![]),
            responses: std::sync::Mutex::new(VecDeque::new()),
        }
    }

    pub fn enqueue_ok(&self, stdout: &str) {
        self.responses.lock().unwrap().push_back(Ok(Output {
            stdout: stdout.into(),
            stderr: String::new(),
            success: true,
        }));
    }

    pub fn enqueue_fail(&self, stderr: &str) {
        self.responses.lock().unwrap().push_back(Ok(Output {
            stdout: String::new(),
            stderr: stderr.into(),
            success: false,
        }));
    }
}

impl Default for FakeRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, args: &[&str]) -> Result<Output, DeviceError> {
        self.calls
            .lock()
            .unwrap()
            .push(args.iter().map(|s| s.to_string()).collect());
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(DeviceError::Other("no scripted response".into())))
    }
}
