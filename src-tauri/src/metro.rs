use serde::Serialize;
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
