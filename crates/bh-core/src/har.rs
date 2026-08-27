use crate::types::{Header, HttpExchange};
use serde::Serialize;
use time::OffsetDateTime;

fn iso(ms: f64) -> String {
    OffsetDateTime::from_unix_timestamp_nanos((ms * 1_000_000.0) as i128)
        .unwrap_or_else(|_| OffsetDateTime::UNIX_EPOCH)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn hdrs(headers: &[Header]) -> Vec<HarNameValue> {
    headers
        .iter()
        .map(|h| HarNameValue {
            name: h.name.clone(),
            value: h.value.clone(),
        })
        .collect()
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarNameValue {
    pub name: String,
    pub value: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarRequest {
    pub method: String,
    pub url: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<HarNameValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub postData: Option<HarPostData>,
    pub headersSize: i64,
    pub bodySize: i64,
    pub httpVersion: String,
    pub cookies: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarPostData {
    pub mimeType: String,
    pub text: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarContent {
    pub size: usize,
    pub mimeType: String,
    pub text: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarResponse {
    pub status: u16,
    pub statusText: String,
    pub httpVersion: String,
    pub headers: Vec<HarNameValue>,
    pub content: HarContent,
    pub cookies: Vec<serde_json::Value>,
    pub headersSize: i64,
    pub bodySize: i64,
    pub redirectURL: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarEntry {
    pub startedDateTime: String,
    pub time: u64,
    pub request: HarRequest,
    pub response: HarResponse,
    pub cache: serde_json::Value,
    pub timings: serde_json::Value,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarLog {
    pub version: String,
    pub creator: HarNameValue,
    pub entries: Vec<HarEntry>,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct HarFile {
    pub log: HarLog,
}

pub fn build_har(exchanges: &[HttpExchange]) -> HarFile {
    let entries = exchanges
        .iter()
        .filter(|e| e.response.is_some())
        .map(|e| {
            let req = &e.request;
            let res = e.response.as_ref().unwrap();
            HarEntry {
                startedDateTime: iso(req.started_at),
                time: e.timing.total_ms.unwrap_or(0),
                request: HarRequest {
                    method: req.method.clone(),
                    url: req.url.clone(),
                    headers: hdrs(&req.headers),
                    postData: req.body.as_ref().map(|b| HarPostData {
                        mimeType: b
                            .mime
                            .clone()
                            .unwrap_or_else(|| "application/octet-stream".into()),
                        text: b.text.clone(),
                    }),
                    headersSize: -1,
                    bodySize: req.body.as_ref().map(|b| b.size as i64).unwrap_or(0),
                    httpVersion: e.protocol.clone(),
                    cookies: vec![],
                },
                response: HarResponse {
                    status: res.status,
                    statusText: String::new(),
                    httpVersion: e.protocol.clone(),
                    headers: hdrs(&res.headers),
                    content: HarContent {
                        size: res.body.as_ref().map(|b| b.size).unwrap_or(0),
                        mimeType: res
                            .body
                            .as_ref()
                            .and_then(|b| b.mime.clone())
                            .unwrap_or_else(|| "application/octet-stream".into()),
                        text: res
                            .body
                            .as_ref()
                            .map(|b| b.text.clone())
                            .unwrap_or_default(),
                    },
                    cookies: vec![],
                    headersSize: -1,
                    bodySize: res.body.as_ref().map(|b| b.size as i64).unwrap_or(0),
                    redirectURL: String::new(),
                },
                cache: serde_json::json!({}),
                timings: serde_json::json!({
                    "wait": e.timing.ttfb_ms.unwrap_or(0),
                    "receive": e.timing.download_ms.unwrap_or(0)
                }),
            }
        })
        .collect();
    HarFile {
        log: HarLog {
            version: "1.2".into(),
            creator: HarNameValue {
                name: "Beholder".into(),
                value: env!("CARGO_PKG_VERSION").into(),
            },
            entries,
        },
    }
}

pub fn har_to_string(exchanges: &[HttpExchange]) -> String {
    serde_json::to_string_pretty(&build_har(exchanges)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BodyCapture, HttpRequest, HttpResponse, Timing};

    fn sample_exchange(id: u64, path: &str, with_response: bool) -> HttpExchange {
        HttpExchange {
            id,
            request: HttpRequest {
                method: "GET".into(),
                url: format!("https://a.dev{}", path),
                host: "a.dev".into(),
                path: path.into(),
                headers: vec![],
                body: None,
                started_at: 1_700_000_000_000.0,
            },
            response: if with_response {
                Some(HttpResponse {
                    status: 200,
                    headers: vec![],
                    body: Some(BodyCapture::from_bytes(
                        b"ok",
                        Some("text/plain".into()),
                        10,
                    )),
                    ended_at: 1_700_000_000_050.0,
                })
            } else {
                None
            },
            error: if with_response {
                None
            } else {
                Some("boom".into())
            },
            timing: Timing {
                ttfb_ms: Some(10),
                download_ms: Some(5),
                total_ms: Some(50),
            },
            protocol: "http/1.1".into(),
        }
    }

    #[test]
    fn completed_exchange_maps_to_entry() {
        let json = har_to_string(&[sample_exchange(1, "/x", true)]);
        assert!(json.contains("\"version\": \"1.2\""));
        assert!(json.contains("\"status\": 200"));
        assert!(json.contains("2023-11-14"));
        assert!(json.contains("\"time\": 50"));
    }

    #[test]
    fn incomplete_exchange_is_skipped() {
        let json = har_to_string(&[sample_exchange(2, "/y", false)]);
        assert!(!json.contains("/y"));
    }
}
