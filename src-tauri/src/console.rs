use bh_console::{ConsoleEvent, ConsoleSink, ShellSink};
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

pub struct ConsoleBatchSink {
    tx: tokio::sync::mpsc::UnboundedSender<ConsoleEvent>,
}

impl ConsoleBatchSink {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ConsoleEvent>();
        tauri::async_runtime::spawn(async move {
            let mut buffer: Vec<ConsoleEvent> = vec![];
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    maybe = rx.recv() => {
                        match maybe {
                            Some(e) => buffer.push(e),
                            None => {
                                if !buffer.is_empty() {
                                    let _ = app.emit("console-batch", &buffer);
                                }
                                break;
                            }
                        }
                    }
                    _ = tick.tick() => {
                        if !buffer.is_empty() {
                            let _ = app.emit("console-batch", &buffer);
                            buffer.clear();
                        }
                    }
                }
            }
        });
        ConsoleBatchSink { tx }
    }
}

impl ConsoleSink for ConsoleBatchSink {
    fn emit(&self, event: ConsoleEvent) {
        let _ = self.tx.send(event);
    }
}

enum ShellEvent {
    Bytes(String),
    Exit(Option<u32>),
}

#[derive(Serialize)]
struct ShellExitPayload {
    code: Option<u32>,
}

pub struct ShellBatchSink {
    tx: tokio::sync::mpsc::UnboundedSender<ShellEvent>,
    pub done: Arc<Notify>,
}

impl ShellBatchSink {
    pub fn spawn(app: AppHandle) -> Arc<Self> {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ShellEvent>();
        let done = Arc::new(Notify::new());
        let task_done = done.clone();
        tauri::async_runtime::spawn(async move {
            let mut buffer: Vec<String> = vec![];
            let mut pending_exit: Option<Option<u32>> = None;
            let mut exit_emitted = false;
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    maybe = rx.recv() => {
                        match maybe {
                            Some(ShellEvent::Bytes(chunk)) => buffer.push(chunk),
                            Some(ShellEvent::Exit(code)) => pending_exit = Some(code),
                            None => {
                                if pending_exit.is_none() && !exit_emitted {
                                    pending_exit = Some(None);
                                }
                                break;
                            }
                        }
                    }
                    _ = tick.tick() => {
                        if !buffer.is_empty() {
                            let _ = app.emit("console-shell-bytes", &buffer);
                            buffer.clear();
                        }
                        if let Some(code) = pending_exit.take() {
                            let _ = app.emit("console-shell-exit", &ShellExitPayload { code });
                            exit_emitted = true;
                        }
                    }
                }
            }
            if !buffer.is_empty() {
                let _ = app.emit("console-shell-bytes", &buffer);
            }
            if let Some(code) = pending_exit.take() {
                let _ = app.emit("console-shell-exit", &ShellExitPayload { code });
            }
            task_done.notify_one();
        });
        Arc::new(ShellBatchSink { tx, done })
    }
}

impl ShellSink for ShellBatchSink {
    fn bytes(&self, chunk: String) {
        let _ = self.tx.send(ShellEvent::Bytes(chunk));
    }

    fn exit(&self, code: Option<u32>) {
        let _ = self.tx.send(ShellEvent::Exit(code));
    }
}
