use crate::decode::decode_content_encoding;
use crate::MetroBypass;
use bh_core::types::*;
use bh_core::TrafficSink;
use futures::SinkExt;
use http_body::Body as HttpBodyTrait;
use http_body_util::{BodyExt, Full};
use hudsucker::{
    hyper::{HeaderMap, Request, Response},
    Body, Error, HttpContext, HttpHandler, RequestOrResponse,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub struct Shared {
    pub sink: Arc<dyn TrafficSink>,
    pub cap: usize,
    pub metro: MetroBypass,
    pub tls_hosts: Vec<String>,
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
    bypassing: bool,
}

impl RecordingHttpHandler {
    pub fn new(
        sink: Arc<dyn TrafficSink>,
        cap: usize,
        metro: MetroBypass,
        tls_hosts: Vec<String>,
    ) -> Self {
        RecordingHttpHandler {
            shared: Arc::new(Shared {
                sink,
                cap,
                metro,
                tls_hosts,
                next_exchange: AtomicU64::new(1),
            }),
            current: None,
            start: None,
            bypassing: false,
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

fn protocol_label(version: hudsucker::hyper::Version) -> String {
    match version {
        hudsucker::hyper::Version::HTTP_11 => "HTTP/1.1",
        hudsucker::hyper::Version::HTTP_2 => "HTTP/2.0",
        hudsucker::hyper::Version::HTTP_10 => "HTTP/1.0",
        _ => "HTTP",
    }
    .to_string()
}

pub(crate) fn rewrite_emulator_host(uri: &hudsucker::hyper::Uri) -> hudsucker::hyper::Uri {
    if uri.host() != Some("10.0.2.2") {
        return uri.clone();
    }
    let mut builder = hudsucker::hyper::Uri::builder();
    if let Some(scheme) = uri.scheme_str() {
        builder = builder.scheme(scheme);
    }
    let authority = match uri.port_u16() {
        Some(port) => format!("127.0.0.1:{port}"),
        None => "127.0.0.1".to_string(),
    };
    builder = builder.authority(authority);
    if let Some(pq) = uri.path_and_query() {
        builder = builder.path_and_query(pq.as_str());
    }
    builder.build().unwrap_or_else(|_| uri.clone())
}

pub(crate) fn is_metro_destination(uri: &hudsucker::hyper::Uri, metro: MetroBypass) -> bool {
    if !metro.enabled {
        return false;
    }
    let host = uri.host();
    let port = uri.port_u16();
    (host == Some("127.0.0.1") || host == Some("10.0.2.2")) && port == Some(metro.port)
}

fn host_in_bypass(host: Option<&str>, hosts: &[String]) -> bool {
    host.is_some_and(|h| hosts.iter().any(|b| b.eq_ignore_ascii_case(h)))
}

fn bypasses_intercept(
    uri: &hudsucker::hyper::Uri,
    metro: MetroBypass,
    tls_hosts: &[String],
) -> bool {
    is_metro_destination(uri, metro) || host_in_bypass(uri.host(), tls_hosts)
}

fn apply_emulator_rewrite(uri: &mut hudsucker::hyper::Uri, headers: &mut HeaderMap) {
    let emulator_target = uri.host() == Some("10.0.2.2");
    *uri = rewrite_emulator_host(uri);
    if emulator_target {
        if let Some(value) = header_str(headers, "host")
            .as_deref()
            .and_then(rewrite_host_header_value)
        {
            if let Ok(v) = hudsucker::hyper::header::HeaderValue::from_str(&value) {
                headers.insert("host", v);
            }
        }
    }
}

fn rewrite_host_header_value(value: &str) -> Option<String> {
    let rest = value.strip_prefix("10.0.2.2")?;
    if rest.is_empty() || rest.starts_with(':') {
        Some(format!("127.0.0.1{rest}"))
    } else {
        None
    }
}

impl HttpHandler for RecordingHttpHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        if req.method() == hudsucker::hyper::Method::CONNECT {
            let (mut parts, body) = req.into_parts();
            parts.uri = rewrite_emulator_host(&parts.uri);
            return Request::from_parts(parts, body).into();
        }
        let bypass = is_metro_destination(req.uri(), self.shared.metro);
        self.bypassing = bypass;
        if bypass {
            let (mut parts, body) = req.into_parts();
            apply_emulator_rewrite(&mut parts.uri, &mut parts.headers);
            return Request::from_parts(parts, body).into();
        }
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

        apply_emulator_rewrite(&mut parts.uri, &mut parts.headers);

        Request::from_parts(parts, rebuilt_body).into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        if self.bypassing {
            return res;
        }
        let id = self.current.unwrap_or(0);
        let start = self.start;
        let ttfb_ms = start.map(|s| s.elapsed().as_millis() as u64);

        let (mut parts, mut body) = res.into_parts();
        let mime = header_str(&parts.headers, "content-type");
        let encoding = header_str(&parts.headers, "content-encoding");
        let exact = HttpBodyTrait::size_hint(&body).exact();

        if !matches!(exact, Some(size) if size as usize <= 16 * 1024 * 1024) {
            let sink = self.shared.sink.clone();
            let cap = self.shared.cap;
            let status = parts.status.as_u16();
            let event_headers = headers_to_domain(&parts.headers);
            let protocol = protocol_label(parts.version);
            let (mut tx, rx) =
                futures::channel::mpsc::channel::<Result<bytes::Bytes, Error>>(32);
            tokio::spawn(async move {
                let mut prefix: Vec<u8> = Vec::new();
                let mut total = 0usize;
                while let Some(frame) = body.frame().await {
                    match frame {
                        Ok(f) => {
                            let data = match f.into_data() {
                                Ok(d) => d,
                                Err(_) => continue,
                            };
                            total += data.len();
                            if prefix.len() < cap {
                                let take = std::cmp::min(cap - prefix.len(), data.len());
                                prefix.extend_from_slice(&data[..take]);
                            }
                            if tx.send(Ok(data)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let _ = tx.send(Err(e)).await;
                            break;
                        }
                    }
                }
                let capture = match decode_content_encoding(&prefix, encoding.as_deref()) {
                    Some(decoded) => BodyCapture::from_prefix(&decoded, mime, cap, decoded.len()),
                    None => BodyCapture::from_prefix(&prefix, mime, cap, total),
                };
                let total_ms = start.map(|s| s.elapsed().as_millis() as u64);
                let download_ms = total_ms.map(|t| t.saturating_sub(ttfb_ms.unwrap_or(0)));
                sink.emit(TrafficEvent::ExchangeCompleted {
                    id,
                    response: HttpResponse {
                        status,
                        headers: event_headers,
                        body: Some(capture),
                        ended_at: now_ms(),
                    },
                    timing: Timing {
                        ttfb_ms,
                        download_ms: Some(download_ms.unwrap_or(0)),
                        total_ms,
                    },
                    protocol,
                });
            });
            return Response::from_parts(parts, Body::from_stream(rx));
        }

        let (body_capture, final_body) = match body.collect().await {
            Ok(collected) => {
                let bytes = collected.to_bytes();
                let decoded = decode_content_encoding(&bytes, encoding.as_deref())
                    .unwrap_or_else(|| bytes.to_vec());
                let capture = BodyCapture::from_bytes(&decoded, mime, self.shared.cap);
                let rebuilt = rebuild_body(&mut parts.headers, bytes);
                (Some(capture), rebuilt)
            }
            Err(_) => (None, Body::empty()),
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
            protocol: protocol_label(parts.version),
        });

        Response::from_parts(parts, final_body)
    }

    async fn should_intercept(&mut self, _ctx: &HttpContext, req: &Request<Body>) -> bool {
        !bypasses_intercept(req.uri(), self.shared.metro, &self.shared.tls_hosts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(s: &str) -> hudsucker::hyper::Uri {
        s.parse().unwrap()
    }

    #[test]
    fn rewrites_only_10_0_2_2_host() {
        assert_eq!(
            rewrite_emulator_host(&uri("http://10.0.2.2:8081/index.bundle?platform=android"))
                .to_string(),
            "http://127.0.0.1:8081/index.bundle?platform=android"
        );
        assert_eq!(
            rewrite_emulator_host(&uri("http://example.com/x?y=1")).to_string(),
            "http://example.com/x?y=1"
        );
        assert_eq!(
            rewrite_emulator_host(&uri("http://127.0.0.1:8081/status")).to_string(),
            "http://127.0.0.1:8081/status"
        );
    }

    #[test]
    fn preserves_port_path_query_and_default_port() {
        assert_eq!(
            rewrite_emulator_host(&uri("http://10.0.2.2/status")).to_string(),
            "http://127.0.0.1/status"
        );
        assert_eq!(
            rewrite_emulator_host(&uri("http://10.0.2.2:8081/a/b?c=d&e=f")).to_string(),
            "http://127.0.0.1:8081/a/b?c=d&e=f"
        );
    }

    #[test]
    fn rewrites_connect_authority_form() {
        assert_eq!(
            rewrite_emulator_host(&uri("10.0.2.2:8081")).to_string(),
            "127.0.0.1:8081"
        );
        assert_eq!(
            rewrite_emulator_host(&uri("example.com:443")).to_string(),
            "example.com:443"
        );
    }

    #[test]
    fn host_header_value_rewrites_only_exact_emulator_host() {
        assert_eq!(
            rewrite_host_header_value("10.0.2.2").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(
            rewrite_host_header_value("10.0.2.2:8081").as_deref(),
            Some("127.0.0.1:8081")
        );
        assert_eq!(rewrite_host_header_value("example.com"), None);
        assert_eq!(rewrite_host_header_value("10.0.2.2.evil.com"), None);
    }

    #[test]
    fn metro_destination_matches_loopback_and_emulator_on_port() {
        let metro = MetroBypass {
            port: 8081,
            enabled: true,
        };
        assert!(is_metro_destination(
            &uri("http://127.0.0.1:8081/status"),
            metro
        ));
        assert!(is_metro_destination(
            &uri("http://10.0.2.2:8081/index.bundle?platform=android"),
            metro
        ));
        assert!(is_metro_destination(&uri("ws://127.0.0.1:8081/hmr"), metro));
        assert!(!is_metro_destination(
            &uri("http://127.0.0.1:8082/status"),
            metro
        ));
        assert!(!is_metro_destination(
            &uri("http://10.0.2.2:9999/status"),
            metro
        ));
        assert!(!is_metro_destination(
            &uri("http://example.com:8081/x"),
            metro
        ));
        assert!(!is_metro_destination(&uri("http://127.0.0.1/status"), metro));
        assert!(!is_metro_destination(
            &uri("http://localhost:8081/status"),
            metro
        ));
    }

    #[test]
    fn metro_destination_requires_enabled() {
        let metro = MetroBypass {
            port: 8081,
            enabled: false,
        };
        assert!(!is_metro_destination(
            &uri("http://127.0.0.1:8081/status"),
            metro
        ));
        assert!(!is_metro_destination(&uri("http://10.0.2.2:8081/x"), metro));
    }

    #[test]
    fn bypass_host_requires_exact_case_insensitive_match() {
        let hosts = vec!["google.com".to_string(), "LocalHost".to_string()];
        assert!(host_in_bypass(Some("google.com"), &hosts));
        assert!(host_in_bypass(Some("GOOGLE.com"), &hosts));
        assert!(host_in_bypass(Some("Google.COM"), &hosts));
        assert!(host_in_bypass(Some("localhost"), &hosts));
        assert!(host_in_bypass(Some("LOCALHOST"), &hosts));
    }

    #[test]
    fn bypass_host_rejects_subdomains_suffixes_and_missing_host() {
        let hosts = vec!["google.com".to_string()];
        assert!(!host_in_bypass(Some("www.google.com"), &hosts));
        assert!(!host_in_bypass(Some("evilgoogle.com"), &hosts));
        assert!(!host_in_bypass(Some("google.com.evil.com"), &hosts));
        assert!(!host_in_bypass(Some("www.google.com.evil.com"), &hosts));
        assert!(!host_in_bypass(None, &hosts));
        assert!(!host_in_bypass(Some("google.com"), &[]));
    }

    #[test]
    fn intercept_gate_decision_matrix() {
        let hosts = vec!["localhost".to_string()];
        let metro_on = MetroBypass {
            port: 8081,
            enabled: true,
        };
        let metro_off = MetroBypass {
            port: 8081,
            enabled: false,
        };

        assert!(bypasses_intercept(
            &uri("localhost:9443"),
            metro_off,
            &hosts
        ));
        assert!(bypasses_intercept(
            &uri("LOCALHOST:9443"),
            metro_off,
            &hosts
        ));
        assert!(bypasses_intercept(
            &uri("https://localhost/x"),
            metro_off,
            &hosts
        ));
        assert!(!bypasses_intercept(
            &uri("example.com:443"),
            metro_off,
            &hosts
        ));
        assert!(!bypasses_intercept(
            &uri("sub.localhost:443"),
            metro_off,
            &hosts
        ));

        assert!(bypasses_intercept(&uri("127.0.0.1:8081"), metro_on, &[]));
        assert!(bypasses_intercept(&uri("10.0.2.2:8081"), metro_on, &[]));
        assert!(!bypasses_intercept(&uri("127.0.0.1:8081"), metro_off, &[]));
        assert!(!bypasses_intercept(&uri("127.0.0.1:8082"), metro_on, &[]));
        assert!(!bypasses_intercept(&uri("example.com:8081"), metro_on, &[]));
    }
}
