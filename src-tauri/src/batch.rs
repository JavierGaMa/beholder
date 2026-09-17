use bh_core::{TrafficEvent, TrafficSink};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn heartbeat_alive(heartbeat: &AtomicU64) -> bool {
    let hb = heartbeat.load(Ordering::Relaxed);
    hb != 0 && now_ms().saturating_sub(hb) < 3000
}

async fn run_sink(
    mut rx: tokio::sync::mpsc::UnboundedReceiver<TrafficEvent>,
    emit: impl Fn(&[TrafficEvent]) + Send + 'static,
    agent: Option<Arc<bh_agent::AgentStore>>,
    heartbeat: Arc<AtomicU64>,
) {
    let mut buffer: Vec<TrafficEvent> = vec![];
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    loop {
        heartbeat.store(now_ms(), Ordering::Relaxed);
        tokio::select! {
            maybe = rx.recv() => {
                match maybe {
                    Some(e) => {
                        if let Some(a) = agent.as_ref() {
                            a.ingest_traffic(&e);
                        }
                        buffer.push(e)
                    }
                    None => {
                        if !buffer.is_empty() {
                            emit(&buffer);
                        }
                        break;
                    }
                }
            }
            _ = tick.tick() => {
                if !buffer.is_empty() {
                    emit(&buffer);
                    buffer.clear();
                }
            }
        }
    }
    heartbeat.store(0, Ordering::Relaxed);
}

pub struct BatchSink {
    tx: tokio::sync::mpsc::UnboundedSender<TrafficEvent>,
    heartbeat: Arc<AtomicU64>,
}

impl BatchSink {
    pub fn spawn(app: AppHandle, agent: Option<Arc<bh_agent::AgentStore>>) -> Self {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<TrafficEvent>();
        let heartbeat = Arc::new(AtomicU64::new(0));
        let emit_app = app;
        let emit = move |buffer: &[TrafficEvent]| {
            let _ = emit_app.emit("traffic-batch", buffer);
        };
        let join = tauri::async_runtime::spawn(run_sink(rx, emit, agent, heartbeat.clone()));
        let hb = heartbeat.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = join.await {
                eprintln!("traffic sink died: {e}");
                hb.store(0, Ordering::Relaxed);
            }
        });
        BatchSink { tx, heartbeat }
    }

    pub fn alive(&self) -> bool {
        heartbeat_alive(&self.heartbeat)
    }
}

impl TrafficSink for BatchSink {
    fn emit(&self, event: TrafficEvent) {
        let _ = self.tx.send(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bh_core::HttpRequest;

    fn sample_event(id: u64) -> TrafficEvent {
        TrafficEvent::ExchangeStarted {
            id,
            request: HttpRequest {
                method: "GET".into(),
                url: format!("https://example.dev/api/{id}"),
                host: "example.dev".into(),
                path: format!("/api/{id}"),
                headers: vec![],
                body: None,
                started_at: 0.0,
            },
        }
    }

    async fn wait_for<F: Fn() -> bool>(predicate: F, window: Duration) -> bool {
        let start = std::time::Instant::now();
        loop {
            if predicate() {
                return true;
            }
            if start.elapsed() >= window {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    #[tokio::test]
    async fn heartbeat_stays_alive_without_traffic() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<TrafficEvent>();
        let heartbeat = Arc::new(AtomicU64::new(0));
        tokio::spawn(run_sink(rx, |_| {}, None, heartbeat.clone()));
        assert!(wait_for(|| heartbeat_alive(&heartbeat), Duration::from_secs(1)).await);
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_millis(300) {
            assert!(heartbeat_alive(&heartbeat));
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        drop(tx);
    }

    #[tokio::test]
    async fn heartbeat_dies_after_senders_drop() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<TrafficEvent>();
        let heartbeat = Arc::new(AtomicU64::new(0));
        tokio::spawn(run_sink(rx, |_| {}, None, heartbeat.clone()));
        assert!(wait_for(|| heartbeat_alive(&heartbeat), Duration::from_secs(1)).await);
        drop(tx);
        assert!(wait_for(|| !heartbeat_alive(&heartbeat), Duration::from_secs(2)).await);
    }

    #[tokio::test]
    async fn events_reach_emit_and_agent_store() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<TrafficEvent>();
        let heartbeat = Arc::new(AtomicU64::new(0));
        let store = Arc::new(bh_agent::AgentStore::new(bh_agent::AgentLimits {
            ring_requests: 8,
            console_lines: 8,
            max_body_chars: 128,
        }));
        let batches = Arc::new(std::sync::Mutex::new(Vec::<TrafficEvent>::new()));
        let recorded = batches.clone();
        let emit = move |buffer: &[TrafficEvent]| {
            recorded.lock().unwrap().extend(buffer.iter().cloned());
        };
        tokio::spawn(run_sink(
            rx,
            emit,
            Some(store.clone()),
            heartbeat.clone(),
        ));
        tx.send(sample_event(7)).unwrap();
        tx.send(sample_event(8)).unwrap();
        drop(tx);
        assert!(
            wait_for(
                || {
                    batches.lock().unwrap().len() == 2
                        && store.request_detail(7).is_some()
                        && store.request_detail(8).is_some()
                },
                Duration::from_secs(2)
            )
            .await
        );
        assert!(matches!(
            batches.lock().unwrap()[0],
            TrafficEvent::ExchangeStarted { id: 7, .. }
        ));
    }
}
