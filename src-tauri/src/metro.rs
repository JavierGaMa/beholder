use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const PROXY_HOST: &str = "10.0.2.2";
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const TICK_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct MetroStatus {
    pub detected: bool,
    pub port: u16,
}

pub async fn probe(port: u16) -> bool {
    let client = match reqwest::Client::builder().timeout(PROBE_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let url = format!("http://127.0.0.1:{port}/status");
    match client.get(&url).send().await {
        Ok(resp) => match resp.text().await {
            Ok(body) => body.trim() == "packager-status:running",
            Err(_) => false,
        },
        Err(_) => false,
    }
}

pub struct MetroTaskHandle {
    shutdown: tokio::sync::oneshot::Sender<()>,
    join: tauri::async_runtime::JoinHandle<()>,
}

impl MetroTaskHandle {
    pub async fn stop(self) {
        let _ = self.shutdown.send(());
        let _ = self.join.await;
    }
}

pub fn spawn_metro_task(app: AppHandle) -> MetroTaskHandle {
    let (shutdown, rx) = tokio::sync::oneshot::channel::<()>();
    let join = tauri::async_runtime::spawn(async move {
        badge_loop(app, rx).await;
    });
    MetroTaskHandle { shutdown, join }
}

pub trait MetroSpawner: Send + Sync {
    fn spawn(&self, cwd: &Path, port: u16) -> Result<Child, bh_device::DeviceError>;
}

pub struct RealMetroSpawner;

impl MetroSpawner for RealMetroSpawner {
    fn spawn(&self, cwd: &Path, port: u16) -> Result<Child, bh_device::DeviceError> {
        let program = if cfg!(windows) { "npx.cmd" } else { "npx" };
        Command::new(program)
            .args(["react-native", "start", "--port", &port.to_string()])
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                bh_device::DeviceError::Other(format!("spawn npx react-native start: {e}"))
            })
    }
}

pub struct MetroProcess {
    child: StdMutex<Child>,
}

impl MetroProcess {
    pub fn wrap(mut child: Child, log: Arc<dyn Fn(&str) + Send + Sync>) -> MetroProcess {
        if let Some(stdout) = child.stdout.take() {
            forward_lines(stdout, log.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            forward_lines(stderr, log.clone());
        }
        MetroProcess {
            child: StdMutex::new(child),
        }
    }

    pub fn is_running(&self) -> bool {
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }

    pub fn stop(&self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn forward_lines(pipe: impl std::io::Read + Send + 'static, log: Arc<dyn Fn(&str) + Send + Sync>) {
    thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            log(&line);
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MetroStartOutcome {
    AlreadyRunning,
    Spawned { running: bool },
}

pub async fn start_metro(
    port: u16,
    root: &Path,
    spawner: &dyn MetroSpawner,
    slot: &mut Option<MetroProcess>,
    probe_budget_secs: u64,
    log: Arc<dyn Fn(&str) + Send + Sync>,
) -> Result<MetroStartOutcome, bh_device::DeviceError> {
    if probe(port).await {
        return Ok(MetroStartOutcome::AlreadyRunning);
    }
    if let Some(existing) = slot.as_ref() {
        if existing.is_running() {
            return Ok(MetroStartOutcome::AlreadyRunning);
        }
    }
    let child = spawner.spawn(root, port)?;
    let process = MetroProcess::wrap(child, log);
    let running = if probe_budget_secs == 0 {
        false
    } else {
        wait_probed(port, probe_budget_secs).await
    };
    *slot = Some(process);
    Ok(MetroStartOutcome::Spawned { running })
}

async fn wait_probed(port: u16, budget_secs: u64) -> bool {
    let polls = budget_secs.saturating_mul(4);
    for _ in 0..polls {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if probe(port).await {
            return true;
        }
    }
    false
}

pub fn stop_metro(slot: &mut Option<MetroProcess>) {
    if let Some(process) = slot.take() {
        process.stop();
    }
}

async fn badge_loop(app: AppHandle, mut shutdown: tokio::sync::oneshot::Receiver<()>) {
    let mut last_status: Option<MetroStatus> = None;
    let mut tick = tokio::time::interval(TICK_INTERVAL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = tick.tick() => {
                let metro = app
                    .path()
                    .app_local_data_dir()
                    .ok()
                    .and_then(|dir| crate::config::load(&dir).ok())
                    .map(|cfg| cfg.metro)
                    .unwrap_or_default();
                let status = MetroStatus {
                    detected: probe(metro.port).await,
                    port: metro.port,
                };
                if last_status.as_ref() != Some(&status) {
                    let _ = app.emit("metro-status", &status);
                    last_status = Some(status);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bh_device::DeviceError;

    async fn spawn_status_server(body: &'static str) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 2048];
                    let _ = socket.read(&mut buf).await;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                });
            }
        });
        port
    }

    #[cfg(unix)]
    fn sleep_child_spawner() -> (
        RecordingSpawner,
        std::sync::Arc<std::sync::Mutex<Vec<Vec<String>>>>,
    ) {
        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let spawner = RecordingSpawner {
            calls: calls.clone(),
        };
        (spawner, calls)
    }

    #[cfg(unix)]
    struct RecordingSpawner {
        calls: std::sync::Arc<std::sync::Mutex<Vec<Vec<String>>>>,
    }

    #[cfg(unix)]
    impl MetroSpawner for RecordingSpawner {
        fn spawn(&self, cwd: &Path, port: u16) -> Result<std::process::Child, DeviceError> {
            self.calls
                .lock()
                .unwrap()
                .push(vec![cwd.display().to_string(), port.to_string()]);
            std::process::Command::new("/bin/sh")
                .args(["-c", "sleep 30"])
                .spawn()
                .map_err(|e| DeviceError::Other(e.to_string()))
        }
    }

    #[tokio::test]
    async fn probe_true_against_running_status_body() {
        let port = spawn_status_server("packager-status:running").await;
        assert!(probe(port).await);
    }

    #[tokio::test]
    async fn probe_false_against_other_body() {
        let port = spawn_status_server("hello world").await;
        assert!(!probe(port).await);
    }

    #[tokio::test]
    async fn probe_false_against_closed_port() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(!probe(port).await);
    }

    #[cfg(unix)]
    fn closed_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        port
    }

    #[cfg(unix)]
    fn null_log() -> std::sync::Arc<dyn Fn(&str) + Send + Sync> {
        std::sync::Arc::new(|_: &str| {})
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn start_metro_spawns_when_port_closed_and_is_idempotent() {
        let (spawner, calls) = sleep_child_spawner();
        let root = Path::new("/tmp");
        let port = closed_port();
        let mut slot: Option<MetroProcess> = None;
        let outcome = start_metro(port, root, &spawner, &mut slot, 0, null_log())
            .await
            .unwrap();
        assert_eq!(outcome, MetroStartOutcome::Spawned { running: false });
        assert_eq!(
            calls.lock().unwrap().clone(),
            vec![vec![root.display().to_string(), port.to_string()]]
        );

        let second = start_metro(port, root, &spawner, &mut slot, 0, null_log())
            .await
            .unwrap();
        assert_eq!(second, MetroStartOutcome::AlreadyRunning);
        assert_eq!(calls.lock().unwrap().len(), 1);

        let process = slot.take().unwrap();
        assert!(process.is_running());
        process.stop();
        assert!(!process.is_running());

        let third = start_metro(port, root, &spawner, &mut slot, 0, null_log())
            .await
            .unwrap();
        assert_eq!(third, MetroStartOutcome::Spawned { running: false });
        assert_eq!(calls.lock().unwrap().len(), 2);
        slot.take().unwrap().stop();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn start_metro_skips_spawn_when_probe_reports_running() {
        let (spawner, calls) = sleep_child_spawner();
        let port = spawn_status_server("packager-status:running").await;
        let mut slot: Option<MetroProcess> = None;
        let outcome = start_metro(port, Path::new("/tmp"), &spawner, &mut slot, 0, null_log())
            .await
            .unwrap();
        assert_eq!(outcome, MetroStartOutcome::AlreadyRunning);
        assert!(calls.lock().unwrap().is_empty());
    }
}
