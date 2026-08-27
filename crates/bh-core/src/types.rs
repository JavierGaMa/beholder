use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WsDirection {
    Sent,
    Received,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BodyCapture {
    pub mime: Option<String>,
    pub size: usize,
    pub truncated: bool,
    pub text: String,
    pub is_binary: bool,
}

impl BodyCapture {
    pub fn from_bytes(bytes: &[u8], mime: Option<String>, cap: usize) -> Self {
        let size = bytes.len();
        let truncated = size > cap;
        let slice = if truncated { &bytes[..cap] } else { bytes };
        let looks_binary = slice.iter().take(512).any(|b| *b == 0);
        let text = if looks_binary {
            format!("{} bytes (binary)", size)
        } else {
            String::from_utf8_lossy(slice).into_owned()
        };
        BodyCapture {
            mime,
            size,
            truncated,
            text,
            is_binary: looks_binary,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub headers: Vec<Header>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<BodyCapture>,
    pub started_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<Header>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<BodyCapture>,
    pub ended_at: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Timing {
    pub ttfb_ms: Option<u64>,
    pub download_ms: Option<u64>,
    pub total_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HttpExchange {
    pub id: u64,
    pub request: HttpRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<HttpResponse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub timing: Timing,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum WsEvent {
    Opened {
        id: u64,
        url: String,
        opened_at: f64,
    },
    Frame {
        id: u64,
        seq: u64,
        direction: WsDirection,
        payload: BodyCapture,
        at: f64,
    },
    Closed {
        id: u64,
        code: Option<u16>,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum TrafficEvent {
    ExchangeStarted {
        id: u64,
        request: HttpRequest,
    },
    ExchangeCompleted {
        id: u64,
        response: HttpResponse,
        timing: Timing,
        protocol: String,
    },
    ExchangeFailed {
        id: u64,
        error: String,
    },
    Ws(WsEvent),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_capture_keeps_small_bodies() {
        let b = BodyCapture::from_bytes(b"hello", Some("text/plain".into()), 10);
        assert_eq!(b.text, "hello");
        assert!(!b.truncated);
        assert_eq!(b.size, 5);
    }

    #[test]
    fn body_capture_truncates_and_marks() {
        let bytes = vec![b'a'; 5000];
        let b = BodyCapture::from_bytes(&bytes, None, 100);
        assert!(b.truncated);
        assert_eq!(b.text.len(), 100);
        assert_eq!(b.size, 5000);
    }

    #[test]
    fn body_capture_detects_binary() {
        let bytes = vec![0u8; 64];
        let b = BodyCapture::from_bytes(&bytes, None, 100);
        assert!(b.is_binary);
        assert!(b.text.contains("binary"));
    }
}
