use crate::store::{AgentStore, ConsoleQuery, ReqQuery, StatusFilter};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub fn discovery_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".beholder").join("agent.json")
}

pub fn generate_token() -> String {
    let mut hex = String::with_capacity(64);
    for i in 0..4u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        h.write_u64(nanos ^ (i << 32) ^ (std::process::id() as u64));
        let _ = h.write(&i.to_le_bytes());
        hex.push_str(&format!("{:016x}", h.finish()));
    }
    hex
}

pub async fn serve(store: Arc<AgentStore>, bind: &str, token: &str) -> std::io::Result<u16> {
    serve_with(store, bind, token, Some(discovery_path())).await
}

pub async fn serve_with(
    store: Arc<AgentStore>,
    bind: &str,
    token: &str,
    discovery: Option<PathBuf>,
) -> std::io::Result<u16> {
    let listener = TcpListener::bind(bind).await?;
    let port = listener.local_addr()?.port();
    if let Some(path) = discovery {
        write_discovery(path, port, token)?;
    }
    let token = token.to_string();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let store = store.clone();
            let token = token.clone();
            tokio::spawn(async move {
                let _ = handle(stream, store, token).await;
            });
        }
    });
    Ok(port)
}

fn write_discovery(path: PathBuf, port: u16, token: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = json!({ "port": port, "token": token }).to_string();
    std::fs::write(&path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

async fn handle(mut stream: TcpStream, store: Arc<AgentStore>, token: String) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 64 * 1024 {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let expected = format!("Bearer {token}");
    let auth_ok = lines.any(|l| {
        l.split_once(':')
            .map(|(k, v)| k.trim().eq_ignore_ascii_case("authorization") && v.trim() == expected)
            .unwrap_or(false)
    });
    let (status, body) = if method != "GET" {
        (405, json!({ "error": "method_not_allowed" }))
    } else if !auth_ok {
        (401, json!({ "error": "unauthorized" }))
    } else {
        route(&store, &target)
    };
    respond(stream, status, &body).await
}

async fn respond(mut stream: TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let payload = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(payload.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

fn route(store: &AgentStore, target: &str) -> (u16, Value) {
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, parse_query(q)),
        None => (target, HashMap::new()),
    };
    match path {
        "/focus" => (200, store.focus()),
        "/requests" => {
            let q = ReqQuery {
                status: StatusFilter::parse(query.get("status").map(|s| s.as_str())),
                search: query.get("search").cloned(),
                host: query.get("host").cloned(),
                since_id: query.get("since_id").and_then(|v| v.parse().ok()).unwrap_or(0),
                limit: query.get("limit").and_then(|v| v.parse().ok()).unwrap_or(50),
            };
            let rows = store.query_requests(&q);
            let lines: Vec<String> = rows.iter().map(crate::format::compact_line).collect();
            (200, json!({ "lines": lines, "count": rows.len() }))
        }
        p if p.starts_with("/requests/") => {
            let id = match p.trim_start_matches("/requests/").parse::<u64>() {
                Ok(i) => i,
                Err(_) => return (400, json!({ "error": "bad_id" })),
            };
            match store.request_detail(id) {
                Some(ex) => {
                    let full = query.get("body").map(|b| b == "full").unwrap_or(false);
                    (200, detail_json(&ex, full, store.limits.max_body_chars))
                }
                None => (404, json!({ "error": "not_found" })),
            }
        }
        "/console" => {
            let q = ConsoleQuery {
                min_level: query.get("level").cloned(),
                search: query.get("search").cloned(),
                limit: query.get("limit").and_then(|v| v.parse().ok()).unwrap_or(100),
            };
            (200, json!({ "lines": store.console_lines(&q) }))
        }
        "/curl" => {
            let id = query.get("id").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            match store.request_detail(id) {
                Some(ex) => (200, json!({ "curl": bh_core::to_curl(&ex) })),
                None => (404, json!({ "error": "not_found" })),
            }
        }
        _ => (404, json!({ "error": "not_found" })),
    }
}

pub fn detail_json(ex: &bh_core::types::HttpExchange, full: bool, max_chars: usize) -> Value {
    let mut v = serde_json::to_value(ex).unwrap_or(Value::Null);
    if full {
        return v;
    }
    for key in ["request", "response"] {
        let Some(body) = v.get_mut(key).and_then(|k| k.get_mut("body")) else { continue };
        let (text, size) = (
            body.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            body.get("size").and_then(Value::as_u64).unwrap_or(0),
        );
        if text.chars().count() > max_chars {
            let cut: String = text.chars().take(max_chars).collect();
            body["text"] = Value::String(format!("{cut}\n[truncated, {size} bytes total]"));
        }
    }
    v
}

fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((pct_decode(k), pct_decode(v)))
        })
        .collect()
}

fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let h = (bytes[i + 1] as char).to_digit(16);
                let l = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (h, l) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            _ => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{AgentLimits, AgentStore};
    use bh_core::types::{HttpRequest, TrafficEvent};
    use serde_json::Value;

    fn store_with_one() -> std::sync::Arc<AgentStore> {
        let s = std::sync::Arc::new(AgentStore::new(AgentLimits::default()));
        s.set_target(Some("emu".into()), None);
        s.ingest_traffic(&TrafficEvent::ExchangeStarted {
            id: 7,
            request: HttpRequest {
                method: "GET".into(),
                url: "https://a.dev/x".into(),
                host: "a.dev".into(),
                path: "/x".into(),
                headers: vec![],
                body: None,
                started_at: 1.0,
            },
        });
        s
    }

    async fn get(port: u16, token: &str, path: &str) -> (u16, Value) {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n");
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.unwrap();
        let text = String::from_utf8_lossy(&buf);
        let status: u16 = text.split_whitespace().nth(1).unwrap().parse().unwrap();
        let body = text.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
        (status, serde_json::from_str(body).unwrap())
    }

    #[tokio::test]
    async fn rejects_missing_token() {
        let store = store_with_one();
        let port = serve_with(store, "127.0.0.1:0", "tok", None).await.unwrap();
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        use tokio::io::AsyncWriteExt;
        stream.write_all(b"GET /focus HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await.unwrap();
        let mut buf = Vec::new();
        use tokio::io::AsyncReadExt;
        stream.read_to_end(&mut buf).await.unwrap();
        let text = String::from_utf8_lossy(&buf);
        assert!(text.starts_with("HTTP/1.1 401"));
    }

    #[tokio::test]
    async fn focus_ok_with_token() {
        let store = store_with_one();
        let port = serve_with(store, "127.0.0.1:0", "tok", None).await.unwrap();
        let (status, body) = get(port, "tok", "/focus").await;
        assert_eq!(status, 200);
        assert_eq!(body["target"], "emu");
        assert_eq!(body["requests"], 1);
    }

    #[tokio::test]
    async fn requests_detail_and_curl_routes() {
        let store = store_with_one();
        let port = serve_with(store, "127.0.0.1:0", "tok", None).await.unwrap();
        let (status, _) = get(port, "tok", "/requests").await;
        assert_eq!(status, 200);
        let (status, detail) = get(port, "tok", "/requests/7").await;
        assert_eq!(status, 200);
        assert_eq!(detail["request"]["path"], "/x");
        let (status, _) = get(port, "tok", "/curl?id=7").await;
        assert_eq!(status, 200);
        let (status, body) = get(port, "tok", "/requests/999").await;
        assert_eq!(status, 404);
        assert_eq!(body["error"], "not_found");
    }
}
