use bh_device::CommandRunner;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const PROXY_HOST: &str = "10.0.2.2";
pub const DEVICE_PROXY_HOST: &str = "127.0.0.1";
const TUNNEL_INTERVAL: Duration = Duration::from_secs(2);
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const TICK_INTERVAL: Duration = Duration::from_secs(3);

pub fn proxy_host(serial: &str) -> &'static str {
    if bh_device::is_emulator_serial(serial) {
        PROXY_HOST
    } else {
        DEVICE_PROXY_HOST
    }
}

pub fn spawn_tunnel_task(
    runner: Arc<dyn CommandRunner>,
    serial: String,
    port: u16,
) -> MetroTaskHandle {
    let (shutdown, mut rx) = tokio::sync::oneshot::channel::<()>();
    let join = tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(TUNNEL_INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tick.tick() => {
                    let runner = runner.clone();
                    let serial = serial.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        bh_device::AdbDevice::new(runner.as_ref(), &serial).reverse(port)
                    })
                    .await;
                }
            }
        }
    });
    MetroTaskHandle { shutdown, join }
}

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

    #[test]
    fn emulators_use_the_host_alias_and_phones_use_loopback() {
        assert_eq!(proxy_host("emulator-5554"), "10.0.2.2");
        assert_eq!(proxy_host("R5CT91"), "127.0.0.1");
        assert_eq!(proxy_host("192.168.1.20:5555"), "127.0.0.1");
    }

    #[tokio::test]
    async fn tunnel_task_reissues_the_reverse_rule_and_stops() {
        let runner = Arc::new(bh_device::FakeRunner::new());
        let task = spawn_tunnel_task(runner.clone(), "R5CT91".into(), 8080);
        tokio::time::sleep(Duration::from_millis(2300)).await;
        task.stop().await;
        let calls = runner.calls.lock().unwrap().clone();
        assert!(calls.len() >= 2, "{calls:?}");
        assert!(calls
            .iter()
            .all(|c| c == &["-s", "R5CT91", "reverse", "tcp:8080", "tcp:8080"]));
        tokio::time::sleep(Duration::from_millis(2300)).await;
        assert_eq!(runner.calls.lock().unwrap().len(), calls.len());
    }

    #[tokio::test]
    async fn probe_true_against_running_status_body() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 2048];
                    let _ = socket.read(&mut buf).await;
                    let body = "packager-status:running";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                });
            }
        });
        assert!(probe(port).await);
        server.abort();
    }

    #[tokio::test]
    async fn probe_false_against_other_body() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 2048];
                    let _ = socket.read(&mut buf).await;
                    let body = "hello world";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                });
            }
        });
        assert!(!probe(port).await);
        server.abort();
    }

    #[tokio::test]
    async fn probe_false_against_closed_port() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(!probe(port).await);
    }
}
