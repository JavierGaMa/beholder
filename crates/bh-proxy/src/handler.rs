use bh_core::types::*;
use bh_core::TrafficSink;
use http_body::Body as HttpBodyTrait;
use http_body_util::{BodyExt, Full};
use hudsucker::{
    hyper::{HeaderMap, Request, Response},
    Body, HttpContext, HttpHandler, RequestOrResponse,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub struct Shared {
    pub sink: Arc<dyn TrafficSink>,
    pub cap: usize,
    pub next_exchange: AtomicU64,
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[derive(Clone)]
pub struct RecordingHttpHandler {
    shared: Arc<Shared>,
    current: Option<u64>,
    start: Option<Instant>,
}

impl RecordingHttpHandler {
    pub fn new(sink: Arc<dyn TrafficSink>, cap: usize) -> Self {
        RecordingHttpHandler {
            shared: Arc::new(Shared {
                sink,
                cap,
                next_exchange: AtomicU64::new(1),
            }),
            current: None,
            start: None,
        }
    }
}

fn headers_to_domain(headers: &HeaderMap) -> Vec<Header> {
    headers
        .iter()
        .map(|(n, v)| Header {
            name: n.to_string(),
            value: String::from_utf8_lossy(v.as_bytes()).into_owned(),
        })
        .collect()
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .map(|v| v.to_str().unwrap_or_default().to_string())
}

fn rebuild_body(parts_headers: &mut HeaderMap, bytes: bytes::Bytes) -> Body {
    parts_headers.remove("transfer-encoding");
    if let Ok(len) = bytes.len().to_string().parse() {
        parts_headers.insert("content-length", len);
    }
    Body::from(Full::new(bytes))
}

impl HttpHandler for RecordingHttpHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        let id = self.shared.next_exchange.fetch_add(1, Ordering::SeqCst);
        self.current = Some(id);
        self.start = Some(Instant::now());

        let (mut parts, body) = req.into_parts();
        let method = parts.method.to_string();
        let uri = parts.uri.clone();
        let url = if uri.host().is_some() {
            uri.to_string()
        } else {
            let host = header_str(&parts.headers, "host").unwrap_or_default();
            let pq = uri
                .path_and_query()
                .map(|pq| pq.as_str().to_string())
                .unwrap_or_else(|| "/".into());
            format!("https://{}{}", host, pq)
        };
        let host = uri
            .host()
            .map(|h| h.to_string())
            .unwrap_or_else(|| header_str(&parts.headers, "host").unwrap_or_default());
        let path = uri.path().to_string();
        let hdrs = headers_to_domain(&parts.headers);
        let mime = header_str(&parts.headers, "content-type");

        let (body_capture, rebuilt_body) = match body.collect().await {
            Ok(collected) => {
                let bytes = collected.to_bytes();
                let cap_bytes = if bytes.len() > self.shared.cap {
                    bytes.slice(0..self.shared.cap)
                } else {
                    bytes.clone()
                };
                let capture = BodyCapture::from_bytes(&cap_bytes, mime, self.shared.cap);
                let rebuilt = rebuild_body(&mut parts.headers, bytes);
                (Some(capture), rebuilt)
            }
            Err(_) => (None, Body::empty()),
        };

        self.shared.sink.emit(TrafficEvent::ExchangeStarted {
            id,
            request: HttpRequest {
                method,
                url,
                host,
                path,
                headers: hdrs,
                body: body_capture,
                started_at: now_ms(),
            },
        });

        Request::from_parts(parts, rebuilt_body).into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let id = self.current.unwrap_or(0);
        let start = self.start;
        let ttfb_ms = start.map(|s| s.elapsed().as_millis() as u64);

        let (mut parts, body) = res.into_parts();
        let mime = header_str(&parts.headers, "content-type");
        let exact = HttpBodyTrait::size_hint(&body).exact();

        let (body_capture, final_body) = match exact {
            Some(size) if size as usize <= 16 * 1024 * 1024 => match body.collect().await {
                Ok(collected) => {
                    let bytes = collected.to_bytes();
                    let cap_bytes = if bytes.len() > self.shared.cap {
                        bytes.slice(0..self.shared.cap)
                    } else {
                        bytes.clone()
                    };
                    let capture = BodyCapture::from_bytes(&cap_bytes, mime, self.shared.cap);
                    let rebuilt = rebuild_body(&mut parts.headers, bytes);
                    (Some(capture), rebuilt)
                }
                Err(_) => (None, Body::empty()),
            },
            _ => (None, body),
        };

        let total_ms = start.map(|s| s.elapsed().as_millis() as u64);
        let download_ms = total_ms.map(|t| t.saturating_sub(ttfb_ms.unwrap_or(0)));

        self.shared.sink.emit(TrafficEvent::ExchangeCompleted {
            id,
            response: HttpResponse {
                status: parts.status.as_u16(),
                headers: headers_to_domain(&parts.headers),
                body: body_capture,
                ended_at: now_ms(),
            },
            timing: Timing {
                ttfb_ms,
                download_ms: Some(download_ms.unwrap_or(0)),
                total_ms,
            },
            protocol: match parts.version {
                hudsucker::hyper::Version::HTTP_11 => "HTTP/1.1",
                hudsucker::hyper::Version::HTTP_2 => "HTTP/2.0",
                hudsucker::hyper::Version::HTTP_10 => "HTTP/1.0",
                _ => "HTTP",
            }
            .to_string(),
        });

        Response::from_parts(parts, final_body)
    }
}
