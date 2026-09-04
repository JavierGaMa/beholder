use serde_json::{json, Value};
use std::io::{BufRead, Write};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PROTOCOL_VERSION: &str = "2024-11-05";

fn tools_descriptor() -> Value {
    json!({
        "tools": [
            {
                "name": "beholder_focus",
                "description": "Current Beholder focus: active target, capture state, request/failure counts, pinned items. Call this first.",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "beholder_requests",
                "description": "Compact request lines (id method path status ms). Default: failures plus pinned, newest window of 50.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "status": { "type": "string", "enum": ["failed", "all"], "default": "failed" },
                        "search": { "type": "string" },
                        "host": { "type": "string" },
                        "since_id": { "type": "integer", "default": 0 },
                        "limit": { "type": "integer", "default": 50 }
                    }
                }
            },
            {
                "name": "beholder_request",
                "description": "Full detail of one exchange by id, bodies truncated by default.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "integer" },
                        "body": { "type": "string", "enum": ["truncated", "full"], "default": "truncated" }
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "beholder_console",
                "description": "Recent console (logcat) lines of the focus app, crashes always included.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "level": { "type": "string", "enum": ["Verbose", "Debug", "Info", "Warn", "Error", "Fatal"] },
                        "search": { "type": "string" },
                        "limit": { "type": "integer", "default": 100 }
                    }
                }
            },
            {
                "name": "beholder_to_curl",
                "description": "cURL replay command for one exchange by id.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "id": { "type": "integer" } },
                    "required": ["id"]
                }
            },
            {
                "name": "beholder_locate",
                "description": "Locate where this request's endpoint appears in the current repo (ripgrep over cwd), returns file:line matches.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "id": { "type": "integer" } },
                    "required": ["id"]
                }
            }
        ]
    })
}

async fn handle_message(method: &str, params: Option<Value>) -> Result<Value, Value> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "beholder-mcp", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(tools_descriptor()),
        "tools/call" => {
            let params = params.unwrap_or(Value::Null);
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match tool_call(name, &args).await {
                Ok(text) => Ok(json!({ "content": [{ "type": "text", "text": text }] })),
                Err(e) => Ok(json!({
                    "content": [{ "type": "text", "text": e }],
                    "isError": true
                })),
            }
        }
        _ => Err(json!({ "code": -32601, "message": "method_not_found" })),
    }
}

async fn tool_call(name: &str, args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_i64).unwrap_or(0);
    match name {
        "beholder_focus" => api_get("/focus").await.map(|v| v.to_string()),
        "beholder_requests" => {
            let mut qs = Vec::new();
            if let Some(status) = args.get("status").and_then(Value::as_str) {
                qs.push(format!("status={status}"));
            }
            if let Some(search) = args.get("search").and_then(Value::as_str) {
                qs.push(format!("search={}", encode(search)));
            }
            if let Some(host) = args.get("host").and_then(Value::as_str) {
                qs.push(format!("host={}", encode(host)));
            }
            if let Some(since) = args.get("since_id").and_then(Value::as_i64) {
                qs.push(format!("since_id={since}"));
            }
            if let Some(limit) = args.get("limit").and_then(Value::as_i64) {
                qs.push(format!("limit={limit}"));
            }
            let query = if qs.is_empty() { String::new() } else { format!("?{}", qs.join("&")) };
            api_get(&format!("/requests{query}")).await.map(|v| v.to_string())
        }
        "beholder_request" => {
            let body = args.get("body").and_then(Value::as_str).unwrap_or("truncated");
            api_get(&format!("/requests/{id}?body={body}")).await.map(|v| v.to_string())
        }
        "beholder_console" => {
            let mut qs = Vec::new();
            if let Some(level) = args.get("level").and_then(Value::as_str) {
                qs.push(format!("level={level}"));
            }
            if let Some(search) = args.get("search").and_then(Value::as_str) {
                qs.push(format!("search={}", encode(search)));
            }
            if let Some(limit) = args.get("limit").and_then(Value::as_i64) {
                qs.push(format!("limit={limit}"));
            }
            let query = if qs.is_empty() { String::new() } else { format!("?{}", qs.join("&")) };
            api_get(&format!("/console{query}")).await.map(|v| v.to_string())
        }
        "beholder_to_curl" => api_get(&format!("/curl?id={id}")).await.map(|v| v.to_string()),
        "beholder_locate" => locate(id).await.map(|v| v.to_string()),
        _ => Err(format!("unknown tool: {name}")),
    }
}

fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn discovery_path() -> std::path::PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    home.join(".beholder").join("agent.json")
}

fn read_discovery() -> Result<(u16, String), String> {
    let path = discovery_path();
    let raw = std::fs::read_to_string(&path).map_err(|_| "Beholder is not running. Start Beholder and retry.".to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|_| "invalid Beholder discovery file".to_string())?;
    Ok((
        v.get("port").and_then(Value::as_u64).ok_or("invalid Beholder discovery file")? as u16,
        v.get("token").and_then(Value::as_str).ok_or("invalid Beholder discovery file")?.to_string(),
    ))
}

async fn api_get(path_and_query: &str) -> Result<Value, String> {
    let (port, token) = read_discovery()?;
    request(port, &token, path_and_query).await
}

async fn request(port: u16, token: &str, path_and_query: &str) -> Result<Value, String> {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|_| "Beholder is not running. Start Beholder and retry.".to_string())?;
    let req = format!(
        "GET {path_and_query} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "invalid response from Beholder".to_string())?;
    let status: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "invalid response from Beholder".to_string())?;
    if status != 200 {
        let detail = serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| body.to_string());
        return Err(format!("Beholder API error {status}: {detail}"));
    }
    serde_json::from_str(body).map_err(|_| "invalid response from Beholder".to_string())
}

fn stable_suffix(url: &str) -> String {
    let no_query = url.split('?').next().unwrap_or(url);
    let path = no_query
        .split_once("://")
        .and_then(|(_, rest)| rest.split_once('/'))
        .map(|(_, p)| p)
        .unwrap_or(no_query);
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let take = segs.len().min(3);
    segs[segs.len() - take..].join("/")
}

async fn locate(id: i64) -> Result<Value, String> {
    let detail = api_get(&format!("/requests/{id}?body=truncated")).await?;
    let url = detail
        .get("request")
        .and_then(|r| r.get("url"))
        .and_then(Value::as_str)
        .ok_or("request not found")?;
    let pattern = stable_suffix(url);
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let out = std::process::Command::new("rg")
        .args(["--line-number", "--no-heading", "-e", &pattern])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("rg is required for locate: {e}"))?;
    let stdout_text = String::from_utf8_lossy(&out.stdout).into_owned();
    let matches: Vec<&str> = stdout_text.lines().take(20).collect();
    if matches.is_empty() {
        return Ok(json!({
            "pattern": pattern,
            "matches": [],
            "note": format!("no matches for '{pattern}' in the current repo")
        }));
    }
    Ok(json!({ "pattern": pattern, "matches": matches }))
}

async fn handle_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let Ok(msg) = serde_json::from_str::<Value>(trimmed) else { return None };
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    let params = msg.get("params").cloned();
    Some(match handle_message(&method, params).await {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    })
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let stdout = std::io::stdout();
    while let Some(line) = rx.recv().await {
        if let Some(out) = handle_line(&line).await {
            let mut lock = stdout.lock();
            let _ = writeln!(lock, "{out}");
            let _ = lock.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn initialize_returns_capabilities() {
        let res = handle_message("initialize", None).await.unwrap();
        assert_eq!(res["protocolVersion"], "2024-11-05");
        assert!(res["capabilities"]["tools"].is_object());
        assert_eq!(res["serverInfo"]["name"], "beholder-mcp");
    }

    #[tokio::test]
    async fn ping_returns_empty_object() {
        let res = handle_message("ping", None).await.unwrap();
        assert_eq!(res, json!({}));
    }

    #[tokio::test]
    async fn tools_list_has_six_tools() {
        let res = handle_message("tools/list", None).await.unwrap();
        let tools = res["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 6);
        for t in tools {
            assert!(t["inputSchema"].is_object());
        }
    }

    #[tokio::test]
    async fn unknown_method_returns_32601() {
        let err = handle_message("resources/list", None).await.unwrap_err();
        assert_eq!(err["code"], -32601);
    }

    #[tokio::test]
    async fn tools_call_unknown_tool_is_domain_error() {
        let res = handle_message("tools/call", Some(json!({ "name": "nope", "arguments": {} })))
            .await
            .unwrap();
        assert_eq!(res["isError"], true);
        assert_eq!(res["content"][0]["type"], "text");
        assert_eq!(res["content"][0]["text"], "unknown tool: nope");
    }

    #[test]
    fn stable_suffix_drops_host_and_query() {
        assert_eq!(stable_suffix("https://a.dev/api/v2/login?x=1"), "api/v2/login");
        assert_eq!(stable_suffix("https://a.dev/health"), "health");
    }

    #[test]
    fn encode_escapes_reserved_chars() {
        assert_eq!(encode("a b/c~d"), "a%20b%2Fc~d");
    }

    #[tokio::test]
    async fn notifications_are_ignored() {
        let line = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        assert!(handle_line(line).await.is_none());
    }

    #[tokio::test]
    async fn handle_line_wraps_result_with_id() {
        let out = handle_line(r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#).await.unwrap();
        assert_eq!(out["jsonrpc"], "2.0");
        assert_eq!(out["id"], 7);
        assert_eq!(out["result"], json!({}));
    }

    #[tokio::test]
    async fn request_against_stub_server() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let n = s.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).into_owned();
            assert!(req.starts_with("GET /focus"));
            assert!(req.contains("Authorization: Bearer tok"));
            let body = r#"{"target":"emu"}"#;
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let v = request(port, "tok", "/focus").await.unwrap();
        assert_eq!(v["target"], "emu");
    }

    #[tokio::test]
    async fn request_maps_http_error_to_domain_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf).await;
            let body = r#"{"error":"not_found"}"#;
            let resp = format!("HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let err = request(port, "tok", "/requests/999").await.unwrap_err();
        assert!(err.contains("404"), "unexpected error: {err}");
        assert!(err.contains("not_found"), "unexpected error: {err}");
    }
}
