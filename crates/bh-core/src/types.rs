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
        let slice = if size > cap { &bytes[..cap] } else { bytes };
        Self::from_prefix(slice, mime, cap, size)
    }

    pub fn from_prefix(prefix: &[u8], mime: Option<String>, cap: usize, total: usize) -> Self {
        let truncated = total > cap;
        let looks_binary = prefix.iter().take(512).any(|b| *b == 0);
        let text = if looks_binary {
            format!("{} bytes (binary)", total)
        } else {
            decode_text(prefix)
        };
        BodyCapture {
            mime,
            size: total,
            truncated,
            text,
            is_binary: looks_binary,
        }
    }
}

fn decode_text(bytes: &[u8]) -> String {
    let err = match std::str::from_utf8(bytes) {
        Ok(s) => return s.to_owned(),
        Err(e) => e,
    };
    let valid = &bytes[..err.valid_up_to()];
    if valid.iter().any(|b| *b >= 0x80) {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    windows_1252(bytes)
}

fn windows_1252(bytes: &[u8]) -> String {
    const HIGH: [char; 32] = [
        '\u{20AC}', '\u{0081}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008D}',
        '\u{017D}', '\u{017F}', '\u{0090}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
        '\u{0153}', '\u{009D}', '\u{017E}', '\u{0178}',
    ];
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => HIGH[(b - 0x80) as usize],
            _ => b as char,
        })
        .collect()
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

    #[test]
    fn body_capture_decodes_latin1_without_replacement_chars() {
        let b = BodyCapture::from_bytes(b"caf\xe9 na\xefve", Some("text/plain".into()), 100);
        assert_eq!(b.text, "café naïve");
        assert!(!b.is_binary);
    }

    #[test]
    fn body_capture_decodes_windows1252_punctuation() {
        let b = BodyCapture::from_bytes(b"smart \x93quotes\x94\x97dash\x85", None, 100);
        assert_eq!(b.text, "smart “quotes”—dash…");
    }

    #[test]
    fn body_capture_keeps_utf8_with_partial_tail() {
        let mut bytes = "café ünïcode ".as_bytes().to_vec();
        bytes.extend_from_slice(b"\xe2\x98");
        let b = BodyCapture::from_bytes(&bytes, None, 1000);
        assert!(b.text.starts_with("café ünïcode "));
        assert!(b.text.contains('\u{FFFD}'));
        assert!(!b.text.contains("Ã©"));
    }

    #[test]
    fn body_capture_from_prefix_reports_real_total() {
        let prefix = vec![b'a'; 100];
        let b = BodyCapture::from_prefix(&prefix, None, 100, 5000);
        assert!(b.truncated);
        assert_eq!(b.size, 5000);
        assert_eq!(b.text.len(), 100);
    }

    #[test]
    fn body_capture_from_prefix_untruncated_when_total_within_cap() {
        let b = BodyCapture::from_prefix(b"hello", Some("text/plain".into()), 10, 5);
        assert!(!b.truncated);
        assert_eq!(b.size, 5);
        assert_eq!(b.text, "hello");
    }
}
