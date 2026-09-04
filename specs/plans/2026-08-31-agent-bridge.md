# Beholder Agent Bridge Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in delegated work
> units. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NEVER COMMIT.** The user commits explicitly. Verification steps replace
> commit steps. No code comments (repo rule). English-only artifacts.

**Goal:** Local read-only HTTP API in Beholder + stdio MCP binary so agents
inspect captured traffic/console of the dev-curated app scope cheaply.

**Architecture:** New crate `crates/bh-agent` (ring-buffer store subscribed via
the existing sinks + minimal HTTP/1.1 server on loopback with token auth,
discovery at `~/.beholder/agent.json`). New crate `crates/beholder-mcp` (stdio
JSON-RPC MCP server, HTTP client of the local API). `src-tauri` wires the store
into `BatchSink`/`ConsoleBatchSink`, adds `[agent]` config and 5 commands.
Frontend adds pin actions and focus-app sync.

**Tech Stack:** Rust (tokio, serde, serde_json only — no new external deps),
TypeScript/React, Vitest.

**Spec:** `specs/2026-08-31-beholder-agent-bridge-design.md`

**Decisions locked (resolving spec open items):**
- MCP implementation: hand-rolled minimal JSON-RPC 2.0 over stdio (protocol
  version `2024-11-05`, methods `initialize`, `ping`, `tools/list`,
  `tools/call`). No `rmcp` dependency.
- Console tap point: `ConsoleBatchSink` task loop in `src-tauri/src/console.rs`.
- WS frames excluded from v1 responses (`TrafficEvent::Ws` ignored on ingest).
- `[agent]` config is read at startup only (live reload applies to UI sections;
  restarting the app applies agent config changes).
- Added beyond spec: `agent_unpin_request` command and `/curl?id=N` endpoint
  (required by the `beholder_to_curl` tool and pin toggling UI).

---

## Task 1: `crates/bh-agent` — store (state, ingestion, focus, pins)

**Files:**
- Create: `crates/bh-agent/Cargo.toml`
- Create: `crates/bh-agent/src/lib.rs`
- Create: `crates/bh-agent/src/store.rs`
- Create: `crates/bh-agent/src/format.rs`
- Modify: `Cargo.toml` (root workspace)

- [ ] **Step 1.1: Register the crate**

`Cargo.toml` (root): add `"crates/bh-agent"` to `members`, and to
`[workspace.dependencies]`:
```toml
bh-agent = { path = "crates/bh-agent" }
```

`crates/bh-agent/Cargo.toml`:
```toml
[package]
name = "bh-agent"
version = "0.1.0"
edition = "2021"

[dependencies]
bh-core = { workspace = true }
bh-console = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
```

`crates/bh-agent/src/lib.rs`:
```rust
pub mod format;
pub mod http;
pub mod store;

pub use http::{discovery_path, generate_token, serve};
pub use store::{AgentLimits, AgentStore};
```
(`http` module arrives in Task 2; declare it now and create an empty
`crates/bh-agent/src/http.rs` containing only `pub fn placeholder() {}` to be
replaced in Task 2, or add the `pub mod http;` line in Task 2 — prefer
creating http.rs with its real content in Task 2 and omitting the `pub mod
http;` line until then.)

- [ ] **Step 1.2: Write failing store tests**

`crates/bh-agent/src/store.rs` (bottom, inline `#[cfg(test)] mod tests` per
repo style):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use bh_core::types::{BodyCapture, HttpRequest};

    fn req(id: u64, path: &str) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            url: format!("https://a.dev{path}"),
            host: "a.dev".into(),
            path: path.into(),
            headers: vec![],
            body: None,
            started_at: 1_700_000_000_000.0,
        }
    }

    fn started(id: u64, path: &str) -> TrafficEvent {
        TrafficEvent::ExchangeStarted { id, request: req(id, path) }
    }

    fn completed(id: u64, status: u16) -> TrafficEvent {
        TrafficEvent::ExchangeCompleted {
            id,
            response: bh_core::types::HttpResponse {
                status,
                headers: vec![],
                body: Some(BodyCapture::from_bytes(b"{}", Some("application/json".into()), 1024)),
                ended_at: 1_700_000_000_100.0,
            },
            timing: bh_core::types::Timing { ttfb_ms: Some(10), download_ms: Some(5), total_ms: Some(50) },
            protocol: "http/1.1".into(),
        }
    }

    #[test]
    fn ingest_assembles_exchange() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started(1, "/login"));
        s.ingest_traffic(&completed(1, 200));
        let all = s.query_requests(&ReqQuery::default());
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].response.as_ref().unwrap().status, 200);
    }

    #[test]
    fn failed_filter_returns_failures_and_pins() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started(1, "/ok"));
        s.ingest_traffic(&completed(1, 200));
        s.ingest_traffic(&started(2, "/bad"));
        s.ingest_traffic(&completed(2, 500));
        s.ingest_traffic(&started(3, "/crash"));
        s.ingest_traffic(&TrafficEvent::ExchangeFailed { id: 3, error: "reset".into() });
        s.ingest_traffic(&started(4, "/pinned-ok"));
        s.ingest_traffic(&completed(4, 200));
        s.pin_request(4);
        let q = ReqQuery { status: StatusFilter::Failed, ..ReqQuery::default() };
        let got: Vec<u64> = s.query_requests(&q).iter().map(|e| e.id).collect();
        assert_eq!(got, vec![2, 3, 4]);
    }

    #[test]
    fn ring_evicts_oldest() {
        let s = AgentStore::new(AgentLimits { ring_requests: 3, ..Default::default() });
        for id in 1..=5 {
            s.ingest_traffic(&started(id, "/x"));
        }
        let q = ReqQuery { status: StatusFilter::All, ..ReqQuery::default() };
        let got: Vec<u64> = s.query_requests(&q).iter().map(|e| e.id).collect();
        assert_eq!(got, vec![3, 4, 5]);
    }

    #[test]
    fn search_filters_by_url_case_insensitive() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started(1, "/Login/Do"));
        let q = ReqQuery { status: StatusFilter::All, search: Some("login".into()), ..ReqQuery::default() };
        assert_eq!(s.query_requests(&q).len(), 1);
    }

    #[test]
    fn focus_reports_counts_and_pins() {
        let s = AgentStore::new(AgentLimits::default());
        s.set_target(Some("emulator-5554".into()), Some("Pixel_7".into()));
        s.set_capture(true);
        s.ingest_traffic(&started(1, "/bad"));
        s.ingest_traffic(&completed(1, 401));
        s.pin_request(1);
        let f = s.focus();
        assert_eq!(f["target"], "emulator-5554 (Pixel_7)");
        assert_eq!(f["capture"], true);
        assert_eq!(f["requests"], 1);
        assert_eq!(f["failures"], 1);
        assert_eq!(f["pinned_requests"][0].as_str().unwrap(), "#1 POST /bad 401 50ms");
    }

    #[test]
    fn focus_without_target_sets_flag() {
        let s = AgentStore::new(AgentLimits::default());
        let f = s.focus();
        assert_eq!(f["no_target"], true);
    }

    #[test]
    fn console_tail_keeps_last_lines() {
        let s = AgentStore::new(AgentLimits { console_lines: 2, ..Default::default() });
        for i in 0..3 {
            s.ingest_console(&log_line(&format!("m{i}")));
        }
        let lines = s.console_lines(&ConsoleQuery::default());
        assert_eq!(lines.len(), 2);
        assert!(lines[1].contains("m2"));
    }

    #[test]
    fn clear_pins_empties() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started(1, "/x"));
        s.pin_request(1);
        s.clear_pins();
        let f = s.focus();
        assert_eq!(f["pinned_requests"].as_array().unwrap().len(), 0);
    }
}
```

`log_line` test helper (add above `mod tests` in store.rs, `#[cfg(test)]`):
```rust
#[cfg(test)]
fn log_line(msg: &str) -> bh_console::LogLine {
    bh_console::LogLine {
        ts_ms: 1,
        level: bh_console::LogLevel::Warn,
        pid: 1,
        tid: 1,
        tag: "Test".into(),
        buffer: bh_console::LogBuffer::Main,
        message: msg.into(),
        is_crash: false,
        repeat_count: 1,
    }
}
```
NOTE: verify the exact `LogLine`/`LogLevel`/`LogBuffer` field/variant names in
`crates/bh-console/src/types.rs` and that `LogLine` derives `Clone +
Serialize`. If `Clone` is missing, add the derive in bh-console (add-only
change). If `focus()`'s compact line must match `"#1 POST /bad 401 50ms"`,
`Timing.total_ms = Some(50)` comes from `completed()`.

- [ ] **Step 1.3: Run tests, verify they fail**

Run: `cargo test -p bh-agent`
Expected: FAIL (store module not implemented).

- [ ] **Step 1.4: Implement `store.rs`**

```rust
use bh_core::types::{HttpExchange, Timing, TrafficEvent};
use bh_console::LogLine;
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};
use std::sync::Mutex;

pub struct AgentLimits {
    pub ring_requests: usize,
    pub console_lines: usize,
    pub max_body_chars: usize,
}

impl Default for AgentLimits {
    fn default() -> Self {
        AgentLimits { ring_requests: 5000, console_lines: 200, max_body_chars: 2048 }
    }
}

#[derive(Default)]
pub struct Focus {
    pub serial: Option<String>,
    pub avd: Option<String>,
    pub capture_on: bool,
    pub app: Option<String>,
}

#[derive(Clone)]
pub enum StatusFilter { Failed, All }

impl Default for StatusFilter {
    fn default() -> Self { StatusFilter::Failed }
}

impl StatusFilter {
    pub fn parse(s: Option<&str>) -> Self {
        match s { Some("all") => StatusFilter::All, _ => StatusFilter::Failed }
    }
}

#[derive(Clone)]
pub struct ReqQuery {
    pub status: StatusFilter,
    pub search: Option<String>,
    pub host: Option<String>,
    pub since_id: u64,
    pub limit: usize,
}

impl Default for ReqQuery {
    fn default() -> Self {
        ReqQuery { status: StatusFilter::Failed, search: None, host: None, since_id: 0, limit: 50 }
    }
}

#[derive(Clone)]
pub struct ConsoleQuery {
    pub min_level: Option<String>,
    pub search: Option<String>,
    pub limit: usize,
}

impl Default for ConsoleQuery {
    fn default() -> Self {
        ConsoleQuery { min_level: None, search: None, limit: 100 }
    }
}

pub fn is_failed(ex: &HttpExchange) -> bool {
    match &ex.response {
        Some(r) => r.status >= 400,
        None => ex.error.is_some(),
    }
}

pub struct AgentStore {
    pub limits: AgentLimits,
    focus: Mutex<Focus>,
    exchanges: Mutex<VecDeque<HttpExchange>>,
    pinned_req: Mutex<BTreeSet<u64>>,
    pinned_logs: Mutex<Vec<LogLine>>,
    console: Mutex<VecDeque<LogLine>>,
}

impl AgentStore {
    pub fn new(limits: AgentLimits) -> Self {
        AgentStore {
            limits,
            focus: Mutex::new(Focus::default()),
            exchanges: Mutex::new(VecDeque::new()),
            pinned_req: Mutex::new(BTreeSet::new()),
            pinned_logs: Mutex::new(Vec::new()),
            console: Mutex::new(VecDeque::new()),
        }
    }

    pub fn set_target(&self, serial: Option<String>, avd: Option<String>) {
        let mut f = self.focus.lock().unwrap();
        f.serial = serial;
        f.avd = avd;
    }

    pub fn set_capture(&self, on: bool) {
        self.focus.lock().unwrap().capture_on = on;
    }

    pub fn set_focus_app(&self, package: Option<String>) {
        self.focus.lock().unwrap().app = package;
    }

    pub fn pin_request(&self, id: u64) {
        self.pinned_req.lock().unwrap().insert(id);
    }

    pub fn unpin_request(&self, id: u64) {
        self.pinned_req.lock().unwrap().remove(&id);
    }

    pub fn pin_log(&self, line: LogLine) {
        let mut p = self.pinned_logs.lock().unwrap();
        if !p.iter().any(|l| l.ts_ms == line.ts_ms && l.message == line.message) {
            p.push(line);
        }
    }

    pub fn clear_pins(&self) {
        self.pinned_req.lock().unwrap().clear();
        self.pinned_logs.lock().unwrap().clear();
    }

    pub fn ingest_traffic(&self, ev: &TrafficEvent) {
        match ev {
            TrafficEvent::ExchangeStarted { id, request } => {
                let mut q = self.exchanges.lock().unwrap();
                q.push_back(HttpExchange {
                    id: *id,
                    request: request.clone(),
                    response: None,
                    error: None,
                    timing: Timing::default(),
                    protocol: String::new(),
                });
                while q.len() > self.limits.ring_requests {
                    q.pop_front();
                }
            }
            TrafficEvent::ExchangeCompleted { id, response, timing, protocol } => {
                let mut q = self.exchanges.lock().unwrap();
                if let Some(ex) = q.iter_mut().rev().find(|e| e.id == *id) {
                    ex.response = Some(response.clone());
                    ex.timing = timing.clone();
                    ex.protocol = protocol.clone();
                }
            }
            TrafficEvent::ExchangeFailed { id, error } => {
                let mut q = self.exchanges.lock().unwrap();
                if let Some(ex) = q.iter_mut().rev().find(|e| e.id == *id) {
                    ex.error = Some(error.clone());
                }
            }
            TrafficEvent::Ws(_) => {}
        }
    }

    pub fn ingest_console(&self, line: &LogLine) {
        let mut q = self.console.lock().unwrap();
        q.push_back(line.clone());
        while q.len() > self.limits.console_lines {
            q.pop_front();
        }
    }

    pub fn query_requests(&self, q: &ReqQuery) -> Vec<HttpExchange> {
        let queue = self.exchanges.lock().unwrap();
        let pinned = self.pinned_req.lock().unwrap();
        let search = q.search.as_deref().map(|s| s.to_lowercase());
        let mut out: Vec<&HttpExchange> = Vec::new();
        for e in queue.iter().rev() {
            if out.len() >= q.limit {
                break;
            }
            if let Some(s) = &search {
                if !e.request.url.to_lowercase().contains(s.as_str()) {
                    continue;
                }
            }
            if let Some(h) = &q.host {
                if &e.request.host != h {
                    continue;
                }
            }
            let pinned_hit = pinned.contains(&e.id);
            let include = match q.status {
                StatusFilter::All => e.id > q.since_id,
                StatusFilter::Failed => (is_failed(e) && e.id > q.since_id) || pinned_hit,
            };
            if include {
                out.push(e);
            }
        }
        out.reverse();
        out.into_iter().cloned().collect()
    }

    pub fn request_detail(&self, id: u64) -> Option<HttpExchange> {
        self.exchanges.lock().unwrap().iter().rev().find(|e| e.id == id).cloned()
    }

    pub fn console_lines(&self, q: &ConsoleQuery) -> Vec<String> {
        let queue = self.console.lock().unwrap();
        let min_rank = q.min_level.as_deref().and_then(level_rank);
        let search = q.search.as_deref().map(|s| s.to_lowercase());
        let mut out: Vec<String> = Vec::new();
        for l in queue.iter().rev() {
            if out.len() >= q.limit {
                break;
            }
            let matches_level = l.is_crash
                || min_rank.map_or(true, |min| level_rank(&format!("{:?}", l.level)).map_or(true, |r| r >= min));
            if !matches_level {
                continue;
            }
            if let Some(s) = &search {
                if !l.message.to_lowercase().contains(s.as_str()) {
                    continue;
                }
            }
            out.push(crate::format::log_line(l));
        }
        out.reverse();
        out
    }

    pub fn focus(&self) -> Value {
        let f = self.focus.lock().unwrap();
        if f.serial.is_none() {
            return json!({
                "no_target": true,
                "hint": "Select a target emulator in Beholder and start capture."
            });
        }
        let q = self.exchanges.lock().unwrap();
        let pinned = self.pinned_req.lock().unwrap();
        let logs = self.pinned_logs.lock().unwrap();
        let target = match (&f.serial, &f.avd) {
            (Some(s), Some(a)) => format!("{s} ({a})"),
            (Some(s), None) => s.clone(),
            _ => String::new(),
        };
        json!({
            "target": target,
            "capture": f.capture_on,
            "app": f.app,
            "requests": q.len(),
            "failures": q.iter().filter(|e| is_failed(e)).count(),
            "pinned_requests": q.iter().filter(|e| pinned.contains(&e.id))
                .map(crate::format::compact_line).collect::<Vec<_>>(),
            "pinned_logs": logs.iter().map(crate::format::log_line).collect::<Vec<_>>(),
        })
    }
}

fn level_rank(name: &str) -> Option<u8> {
    match name.to_lowercase().as_str() {
        "verbose" | "v" => Some(0),
        "debug" | "d" => Some(1),
        "info" | "i" => Some(2),
        "warn" | "w" => Some(3),
        "error" | "e" => Some(4),
        "fatal" | "f" => Some(5),
        _ => None,
    }
}
```

- [ ] **Step 1.5: Implement `format.rs`**

```rust
use bh_core::types::HttpExchange;
use bh_console::LogLine;

pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{}…", cut.trim_end())
    }
}

pub fn compact_line(ex: &HttpExchange) -> String {
    let status = match (&ex.response, &ex.error) {
        (Some(r), _) => r.status.to_string(),
        (None, Some(e)) => format!("ERR {}", truncate_chars(e, 24)),
        (None, None) => "...".to_string(),
    };
    let ms = ex.timing.total_ms.map(|m| format!(" {m}ms")).unwrap_or_default();
    format!("#{} {} {} {}{}", ex.id, ex.request.method, ex.request.path, status, ms)
}

pub fn log_line(l: &LogLine) -> String {
    let level = format!("{:?}", l.level).chars().next().unwrap_or('?');
    format!("{level} {} {}", l.tag, truncate_chars(&l.message, 160))
}
```

- [ ] **Step 1.6: Run tests**

Run: `cargo test -p bh-agent`
Expected: PASS (all store tests green).

---

## Task 2: `crates/bh-agent` — HTTP server, token, discovery file

**Files:**
- Create: `crates/bh-agent/src/http.rs`
- Modify: `crates/bh-agent/src/lib.rs` (add `pub mod http;` if deferred)

- [ ] **Step 2.1: Write failing HTTP tests** (append to `http.rs`)

```rust
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
        let port = serve(store, "127.0.0.1:0", "tok").await.unwrap();
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
        let port = serve(store, "127.0.0.1:0", "tok").await.unwrap();
        let (status, body) = get(port, "tok", "/focus").await;
        assert_eq!(status, 200);
        assert_eq!(body["target"], "emu");
        assert_eq!(body["requests"], 1);
    }

    #[tokio::test]
    async fn requests_detail_and_curl_routes() {
        let store = store_with_one();
        let port = serve(store, "127.0.0.1:0", "tok").await.unwrap();
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
```
NOTE: tests call `serve` which writes `~/.beholder/agent.json`. To avoid
clobbering a real discovery file during tests, `serve` takes the discovery
path as a parameter: `serve(store, bind, token)` internally calls
`write_discovery(port, token)` — for tests, factor
`serve_with(store, bind, token, discovery: Option<PathBuf>)`; `serve` calls
`serve_with(..., Some(discovery_path()))`, tests call `serve_with(..., None)`
bypassing the file write. Adjust the tests above to use `serve_with(store,
"127.0.0.1:0", "tok", None)`.

- [ ] **Step 2.2: Run tests, verify fail**

Run: `cargo test -p bh-agent`
Expected: FAIL (http module empty).

- [ ] **Step 2.3: Implement `http.rs`**

```rust
use crate::store::{AgentStore, ConsoleQuery, ReqQuery, StatusFilter};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
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
            b'%' if i + 2 < bytes.len() + 1 && i + 2 < bytes.len() + 1 => {
                let hex_ok = i + 2 < bytes.len() || i + 2 == bytes.len() - 1;
                if hex_ok {
                    let h = (bytes[i + 1] as char).to_digit(16);
                    let l = (bytes[i + 2] as char).to_digit(16);
                    if let (Some(h), Some(l)) = (h, l) {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                        continue;
                    }
                }
                out.push(bytes[i]);
                i += 1;
            }
            _ => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
```
NOTE: the `b'%'` guard above is written defensively; simplify to
`b'%' if i + 2 < bytes.len() + 1` → actually use `i + 2 <= bytes.len() - 1`
i.e. `i + 2 < bytes.len()` is required to index `bytes[i + 2]` when the triple
is not at the very end; for the very-end case `i + 2 == bytes.len() - 1` holds.
Correct guard: `b'%' if i + 2 <= bytes.len() - 1`. Use that. Simplify the
branch body to attempt the hex parse and fall through to pushing `%` on
failure. Also: `bh_core::to_curl` — use the same import path
`src-tauri/src/commands.rs` already uses for `to_curl` (see its `use` block;
`crates/bh-core/src/curl.rs` defines `pub fn to_curl`). If it is not
re-exported at crate root, either use `bh_core::curl::to_curl` or add `pub use
curl::to_curl;` in `crates/bh-core/src/lib.rs`.

- [ ] **Step 2.4: Run all bh-agent tests**

Run: `cargo test -p bh-agent && cargo check --workspace`
Expected: PASS, workspace check clean.

---

## Task 3: `crates/beholder-mcp` — stdio MCP binary

**Files:**
- Create: `crates/beholder-mcp/Cargo.toml`
- Create: `crates/beholder-mcp/src/main.rs`
- Modify: `Cargo.toml` (root workspace members)

- [ ] **Step 3.1: Register crate**

`crates/beholder-mcp/Cargo.toml`:
```toml
[package]
name = "beholder-mcp"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
bh-core = { workspace = true }
```
Root `Cargo.toml`: add `"crates/beholder-mcp"` to members. (No
workspace.dependencies entry needed; nothing depends on it.)

- [ ] **Step 3.2: Write failing tests** (inline in `main.rs`)

```rust
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
    async fn tools_list_has_six_tools() {
        let res = handle_message("tools/list", None).await.unwrap();
        let tools = res["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 6);
        for t in tools {
            assert!(t["inputSchema"].is_object());
        }
    }

    #[test]
    fn stable_suffix_drops_host_and_query() {
        assert_eq!(stable_suffix("https://a.dev/api/v2/login?x=1"), "api/v2/login");
        assert_eq!(stable_suffix("https://a.dev/health"), "health");
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
}
```

- [ ] **Step 3.3: Run, verify fail**

Run: `cargo test -p beholder-mcp`
Expected: FAIL.

- [ ] **Step 3.4: Implement `main.rs`**

```rust
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
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
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
    let matches: Vec<&str> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .take(20)
        .collect();
    Ok(json!({ "pattern": pattern, "matches": matches }))
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
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(trimmed) else { continue };
        if msg.get("id").is_none() {
            continue;
        }
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
        let params = msg.get("params").cloned();
        let out = match handle_message(&method, params).await {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        };
        let mut lock = stdout.lock();
        let _ = writeln!(lock, "{out}");
        let _ = lock.flush();
    }
}
```
NOTE: `main.rs` compiles as binary named `beholder-mcp` (package name gives
the binary name automatically).

- [ ] **Step 3.5: Run tests**

Run: `cargo test -p beholder-mcp && cargo check --workspace`
Expected: PASS.

---

## Task 4: `src-tauri` wiring — config, sinks, commands, setup

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/batch.rs`
- Modify: `src-tauri/src/console.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 4.1: Dependency + config section**

`src-tauri/Cargo.toml` dependencies add:
```toml
bh-agent = { workspace = true }
```

`src-tauri/src/config.rs` add after `ConsoleConfig`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentConfig {
    #[serde(default = "default_agent_enabled")]
    pub enabled: bool,
    #[serde(default = "default_agent_bind")]
    pub bind: String,
    #[serde(default = "default_max_body_chars")]
    pub max_body_chars: usize,
    #[serde(default = "default_ring_requests")]
    pub ring_requests: usize,
    #[serde(default = "default_console_lines")]
    pub console_lines: usize,
}

fn default_agent_enabled() -> bool { true }
fn default_agent_bind() -> String { "127.0.0.1:0".into() }
fn default_max_body_chars() -> usize { 2048 }
fn default_ring_requests() -> usize { 5000 }
fn default_console_lines() -> usize { 200 }

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            enabled: default_agent_enabled(),
            bind: default_agent_bind(),
            max_body_chars: default_max_body_chars(),
            ring_requests: default_ring_requests(),
            console_lines: default_console_lines(),
        }
    }
}
```
In `UiConfig` add field: `#[serde(default)] pub agent: AgentConfig,` and
extend `impl Default for UiConfig` with `agent: AgentConfig::default()`.

Add test (mirror `roundtrip_toml_with_console_section`):
```rust
#[test]
fn agent_defaults_when_section_missing() {
    let dir = std::env::temp_dir().join(format!("bh-cfg-agent-def-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
    let loaded = load(&dir).unwrap();
    assert_eq!(loaded.agent, AgentConfig::default());
    assert!(loaded.agent.enabled);
    assert_eq!(loaded.agent.bind, "127.0.0.1:0");
    std::fs::remove_dir_all(&dir).ok();
}
```

- [ ] **Step 4.2: AgentState + sink taps**

`src-tauri/src/state.rs` add:
```rust
pub struct AgentState {
    pub store: Arc<bh_agent::AgentStore>,
}
```

`src-tauri/src/batch.rs`: change signature
`pub fn spawn(app: AppHandle, agent: Option<Arc<bh_agent::AgentStore>>) -> Self`,
move `agent` into the task, and in the `Some(e) => { ... }` arm call
`if let Some(a) = agent.as_ref() { a.ingest_traffic(&e); }` before
`buffer.push(e)`.

`src-tauri/src/console.rs`: `ConsoleBatchSink::spawn` gains
`agent: Option<Arc<bh_agent::AgentStore>>`; in its `Some(e)` arm:
```rust
if let Some(a) = agent.as_ref() {
    if let bh_console::ConsoleEvent::Line(l) = &e {
        a.ingest_console(l);
    }
}
```
(Verify `ConsoleEvent` variant names in `crates/bh-console/src/types.rs:85`;
adapt the pattern if different.)

- [ ] **Step 4.3: Commands**

`src-tauri/src/commands.rs` add:
```rust
#[tauri::command]
pub fn agent_pin_request(agent: State<'_, crate::state::AgentState>, id: u64) -> Result<(), String> {
    agent.store.pin_request(id);
    Ok(())
}

#[tauri::command]
pub fn agent_unpin_request(agent: State<'_, crate::state::AgentState>, id: u64) -> Result<(), String> {
    agent.store.unpin_request(id);
    Ok(())
}

#[tauri::command]
pub fn agent_pin_log(agent: State<'_, crate::state::AgentState>, line: bh_console::LogLine) -> Result<(), String> {
    agent.store.pin_log(line);
    Ok(())
}

#[tauri::command]
pub fn agent_clear_pins(agent: State<'_, crate::state::AgentState>) -> Result<(), String> {
    agent.store.clear_pins();
    Ok(())
}

#[tauri::command]
pub fn agent_set_focus_app(agent: State<'_, crate::state::AgentState>, package: Option<String>) -> Result<(), String> {
    agent.store.set_focus_app(package);
    Ok(())
}
```
In `capture_start` (line ~404): change
`*state.active_serial.lock().await = Some(serial);` to
```rust
*state.active_serial.lock().await = Some(serial.clone());
if let Some(agent) = app.try_state::<crate::state::AgentState>() {
    agent.store.set_target(Some(serial.clone()), emu_avd_name(runner.as_ref(), &serial));
    agent.store.set_capture(true);
}
```
In `capture_stop`: add `app: tauri::AppHandle` parameter and before `Ok(())`:
```rust
if let Some(agent) = app.try_state::<crate::state::AgentState>() {
    agent.store.set_capture(false);
}
```

- [ ] **Step 4.4: `lib.rs` setup**

Restructure `.setup()` body:
```rust
.setup(|app| {
    let agent_store = {
        let limits = app
            .path()
            .app_local_data_dir()
            .ok()
            .and_then(|dir| config::load(&dir).ok())
            .map(|c| bh_agent::AgentLimits {
                ring_requests: c.agent.ring_requests,
                console_lines: c.agent.console_lines,
                max_body_chars: c.agent.max_body_chars,
            })
            .unwrap_or_default();
        let store = Arc::new(bh_agent::AgentStore::new(limits));
        let agent_cfg = app
            .path()
            .app_local_data_dir()
            .ok()
            .and_then(|dir| config::load(&dir).ok())
            .map(|c| c.agent)
            .unwrap_or_default();
        if agent_cfg.enabled {
            let store = store.clone();
            let bind = agent_cfg.bind.clone();
            tauri::async_runtime::spawn(async move {
                let token = bh_agent::generate_token();
                if let Err(e) = bh_agent::serve(store, &bind, &token).await {
                    eprintln!("agent api failed: {e}");
                }
            });
        }
        store
    };
    let sink = Arc::new(batch::BatchSink::spawn(app.handle().clone(), Some(agent_store.clone())));
    app.manage(state::AppState::new(sink));
    let console_sink = Arc::new(console::ConsoleBatchSink::spawn(app.handle().clone(), Some(agent_store.clone())));
    app.manage(state::ConsoleState::new(console_sink));
    app.manage(state::AgentState { store: agent_store });

    let handle = app.handle().clone();
    std::thread::spawn(move || {
        if let Ok(dir) = handle.path().app_local_data_dir() {
            spawn_config_watcher(handle.clone(), dir);
        }
    });
    Ok(())
})
```
(Load config once instead of twice — bind it once to a variable and reuse for
limits + enabled/bind. Keep the shape above or tighten it; behavior must
match.)

Register new commands in `invoke_handler`: `commands::agent_pin_request,
commands::agent_unpin_request, commands::agent_pin_log,
commands::agent_clear_pins, commands::agent_set_focus_app`.

- [ ] **Step 4.5: Verify**

Run: `cargo test --workspace && cargo check --workspace`
Expected: PASS including all pre-existing tests (sink signature changes must
not break console/batch tests — fix call sites if any construct the sinks
directly).

---

## Task 5: Frontend — pins, badge, focus sync

**Files:**
- Create: `src/features/requests/pins.ts`
- Create: `src/features/requests/pins.test.ts`
- Modify: `src/features/requests/RequestsView.tsx`
- Modify: `src/features/requests/RequestRow.tsx`
- Modify: `src/features/console/ConsoleView.tsx` (selectApp, ~line 165)
- Modify: `src/features/console/LogRow.tsx`
- Modify: `src/features/console/appfilter.ts` (add sync helper + test `src/features/console/appfilter.test.ts` if not present)

- [ ] **Step 5.1: `pins.ts` + test**

```ts
export function togglePinned(pinned: Set<number>, id: number): Set<number> {
  const next = new Set(pinned);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
```
```ts
import { describe, expect, it } from "vitest";
import { togglePinned } from "./pins";

describe("togglePinned", () => {
  it("adds an unpinned id", () => {
    expect(togglePinned(new Set(), 3)).toEqual(new Set([3]));
  });
  it("removes a pinned id", () => {
    expect(togglePinned(new Set([3]), 3)).toEqual(new Set());
  });
});
```

- [ ] **Step 5.2: RequestsView pin + badge**

Import `Pin` from `lucide-react` and `togglePinned` from `./pins`. Add state:
`const [pinned, setPinned] = useState<Set<number>>(new Set());`
In `buildCtxItems`, insert after "Copy URL":
```tsx
{
  label: pinned.has(ex.id) ? "Unpin for agent" : "Pin for agent",
  icon: Pin,
  onSelect: () => {
    const wasPinned = pinned.has(ex.id);
    setPinned(togglePinned(pinned, ex.id));
    void invoke(wasPinned ? "agent_unpin_request" : "agent_pin_request", { id: ex.id });
  },
},
```
`RequestRow.tsx`: add optional `pinned?: boolean` prop; when set, render an
accent dot (e.g. `<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />`)
next to the method text, matching existing row markup conventions. Pass
`pinned={pinned.has(ex.id)}` where RequestRow is rendered in RequestsView.

- [ ] **Step 5.3: Console focus sync + log pin**

In `appfilter.ts` add:
```ts
import { invoke } from "../../lib/tauri";

export function syncFocusApp(pkg: string | null): void {
  void invoke("agent_set_focus_app", { package: pkg });
}
```
In `ConsoleView.tsx` `selectApp` (~line 165): after updating the app filter
state, call `syncFocusApp(app ? app.package : null)` (adapt to the actual
local variable holding the selected `AppFilter`).
In `LogRow.tsx`: add optional `onPin` prop; render a hover `Pin` icon button
(title "Pin for agent") that calls `onPin(line)` when present.
In `ConsoleView.tsx`: pass `onPin={(line) => void invoke("agent_pin_log", { line })}`
to log rows (reuse the existing `invoke` import from `../../lib/tauri`; adapt
to actual row rendering structure).
Test for `syncFocusApp` in `appfilter.test.ts`: mock `../../lib/tauri`
(`vi.mock`) asserting `invoke` called with `("agent_set_focus_app", { package: "com.x" })`
and `{ package: null }` on clear.

- [ ] **Step 5.4: Verify**

Run: `npm run check && npm run lint && npm test`
Expected: all PASS.

---

## Final verification (all units)

- [ ] `cargo test --workspace`
- [ ] `cargo check --workspace`
- [ ] `npm run check && npm run lint && npm test`
- [ ] Manual smoke (optional, requires emulator): start Beholder, start
  capture, confirm `~/.beholder/agent.json` exists; `curl -s
  -H "Authorization: Bearer $(jq -r .token ~/.beholder/agent.json)"
  http://127.0.0.1:$(jq -r .port ~/.beholder/agent.json)/focus`.
- [ ] Report results. DO NOT COMMIT.
```
