use bh_core::{TrafficEvent, TrafficSink};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct BatchSink {
    tx: tokio::sync::mpsc::UnboundedSender<TrafficEvent>,
}

impl BatchSink {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<TrafficEvent>();
        tauri::async_runtime::spawn(async move {
            let mut buffer: Vec<TrafficEvent> = vec![];
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    maybe = rx.recv() => {
                        match maybe {
                            Some(e) => buffer.push(e),
                            None => {
                                if !buffer.is_empty() {
                                    let _ = app.emit("traffic-batch", &buffer);
                                }
                                break;
                            }
                        }
                    }
                    _ = tick.tick() => {
                        if !buffer.is_empty() {
                            let _ = app.emit("traffic-batch", &buffer);
                            buffer.clear();
                        }
                    }
                }
            }
        });
        BatchSink { tx }
    }
}

impl TrafficSink for BatchSink {
    fn emit(&self, event: TrafficEvent) {
        let _ = self.tx.send(event);
    }
}
