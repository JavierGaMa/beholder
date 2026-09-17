use crate::handler::{is_metro_destination, now_ms};
use crate::MetroBypass;
use bh_core::types::*;
use bh_core::TrafficSink;
use hudsucker::{tokio_tungstenite::tungstenite::Message, WebSocketContext, WebSocketHandler};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub struct RecordingWsHandler {
    sink: Arc<dyn TrafficSink>,
    cap: usize,
    metro: MetroBypass,
    next_conn: Arc<AtomicU64>,
    next_seq: Arc<AtomicU64>,
    conn: Option<u64>,
}

impl RecordingWsHandler {
    pub fn new(sink: Arc<dyn TrafficSink>, cap: usize, metro: MetroBypass) -> Self {
        RecordingWsHandler {
            sink,
            cap,
            metro,
            next_conn: Arc::new(AtomicU64::new(1)),
            next_seq: Arc::new(AtomicU64::new(1)),
            conn: None,
        }
    }
}

impl WebSocketHandler for RecordingWsHandler {
    async fn handle_message(&mut self, ctx: &WebSocketContext, msg: Message) -> Option<Message> {
        let (direction, url, peer) = match ctx {
            WebSocketContext::ClientToServer { dst, .. } => {
                (WsDirection::Sent, dst.to_string(), dst.clone())
            }
            WebSocketContext::ServerToClient { src, .. } => {
                (WsDirection::Received, src.to_string(), src.clone())
            }
        };
        if is_metro_destination(&peer, self.metro) {
            return Some(msg);
        }
        if self.conn.is_none() {
            let id = self.next_conn.fetch_add(1, Ordering::SeqCst);
            self.conn = Some(id);
            self.sink.emit(TrafficEvent::Ws(WsEvent::Opened {
                id,
                url,
                opened_at: now_ms(),
            }));
        }
        let conn_id = self.conn.unwrap_or(0);
        let payload = match &msg {
            Message::Text(t) => {
                BodyCapture::from_bytes(t.as_bytes(), Some("text/plain".into()), self.cap)
            }
            Message::Binary(b) => {
                BodyCapture::from_bytes(b, Some("application/octet-stream".into()), self.cap)
            }
            _ => return Some(msg),
        };
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        self.sink.emit(TrafficEvent::Ws(WsEvent::Frame {
            id: conn_id,
            seq,
            direction,
            payload,
            at: now_ms(),
        }));
        Some(msg)
    }
}
