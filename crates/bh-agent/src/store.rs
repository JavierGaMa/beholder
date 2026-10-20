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
pub enum StatusFilter {
    Failed,
    All,
}

impl Default for StatusFilter {
    fn default() -> Self {
        StatusFilter::Failed
    }
}

impl StatusFilter {
    pub fn parse(s: Option<&str>) -> Self {
        match s {
            Some("all") => StatusFilter::All,
            _ => StatusFilter::Failed,
        }
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

#[derive(Debug, Default, Clone, PartialEq, serde::Serialize)]
pub struct SessionTotals {
    pub count: u64,
    pub failed: u64,
    pub wire_bytes_in: u64,
    pub bytes_out: u64,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct DomainStat {
    pub host: String,
    pub count: u64,
    pub failed: u64,
    pub wire_bytes_in: u64,
    pub bytes_out: u64,
    pub p95_ms: Option<u64>,
}

fn wire_bytes_in(ex: &HttpExchange) -> u64 {
    ex.response
        .as_ref()
        .and_then(|r| r.body.as_ref())
        .map(|b| b.wire_size.unwrap_or(b.size) as u64)
        .unwrap_or(0)
}

fn percentile(sorted: &[u64], p: u64) -> Option<u64> {
    if sorted.is_empty() {
        return None;
    }
    let rank = ((p as f64 / 100.0) * sorted.len() as f64).ceil() as usize;
    Some(sorted[rank.saturating_sub(1).min(sorted.len() - 1)])
}

pub fn top_domains<'a>(
    exchanges: impl IntoIterator<Item = &'a HttpExchange>,
    limit: usize,
) -> Vec<DomainStat> {
    use std::collections::BTreeMap;
    let mut acc: BTreeMap<String, (u64, u64, u64, u64, Vec<u64>)> = BTreeMap::new();
    for ex in exchanges {
        let entry = acc.entry(ex.request.host.clone()).or_default();
        entry.0 += 1;
        if is_failed(ex) {
            entry.1 += 1;
        }
        entry.2 += wire_bytes_in(ex);
        entry.3 += ex.request.body.as_ref().map(|b| b.size as u64).unwrap_or(0);
        if let Some(t) = ex.timing.total_ms {
            entry.4.push(t);
        }
    }
    let mut rows: Vec<DomainStat> = acc
        .into_iter()
        .map(|(host, mut e)| {
            e.4.sort_unstable();
            DomainStat {
                host,
                count: e.0,
                failed: e.1,
                wire_bytes_in: e.2,
                bytes_out: e.3,
                p95_ms: percentile(&e.4, 95),
            }
        })
        .collect();
    rows.sort_by(|a, b| b.wire_bytes_in.cmp(&a.wire_bytes_in).then(a.host.cmp(&b.host)));
    rows.truncate(limit);
    rows
}

pub struct AgentStore {
    pub limits: AgentLimits,
    focus: Mutex<Focus>,
    exchanges: Mutex<VecDeque<HttpExchange>>,
    pinned_req: Mutex<BTreeSet<u64>>,
    pinned_logs: Mutex<Vec<LogLine>>,
    console: Mutex<VecDeque<LogLine>>,
    session: Mutex<SessionTotals>,
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
            session: Mutex::new(SessionTotals::default()),
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

    pub fn focus_app(&self) -> Option<String> {
        self.focus.lock().unwrap().app.clone()
    }

    pub fn pins_count(&self) -> usize {
        let requests = self.pinned_req.lock().unwrap().len();
        let logs = self.pinned_logs.lock().unwrap().len();
        requests + logs
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
                let mut st = self.session.lock().unwrap();
                st.count += 1;
                st.bytes_out += request.body.as_ref().map(|b| b.size as u64).unwrap_or(0);
            }
            TrafficEvent::ExchangeCompleted { id, response, timing, protocol } => {
                let mut q = self.exchanges.lock().unwrap();
                if let Some(ex) = q.iter_mut().rev().find(|e| e.id == *id) {
                    if ex.response.is_none() {
                        let mut st = self.session.lock().unwrap();
                        st.wire_bytes_in +=
                            response.body.as_ref().map(|b| b.wire_size.unwrap_or(b.size) as u64).unwrap_or(0);
                        if response.status >= 400 {
                            st.failed += 1;
                        }
                    }
                    ex.response = Some(response.clone());
                    ex.timing = timing.clone();
                    ex.protocol = protocol.clone();
                }
            }
            TrafficEvent::ExchangeFailed { id, error } => {
                let mut q = self.exchanges.lock().unwrap();
                if let Some(ex) = q.iter_mut().rev().find(|e| e.id == *id) {
                    if ex.response.is_none() && ex.error.is_none() {
                        self.session.lock().unwrap().failed += 1;
                    }
                    ex.error = Some(error.clone());
                }
            }
            TrafficEvent::Ws(_) => {}
        }
    }

    pub fn session_totals(&self) -> SessionTotals {
        self.session.lock().unwrap().clone()
    }

    pub fn metrics_json(&self) -> Value {
        let st = self.session.lock().unwrap();
        let q = self.exchanges.lock().unwrap();
        serde_json::json!({
            "session": {
                "count": st.count,
                "failed": st.failed,
                "wire_bytes_in": st.wire_bytes_in,
                "bytes_out": st.bytes_out,
            },
            "window": {
                "count": q.len(),
                "domains": top_domains(q.iter(), 10),
            }
        })
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
                || min_rank.map_or(true, |min| {
                    level_rank(&format!("{:?}", l.level)).map_or(true, |r| r >= min)
                });
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

#[cfg(test)]
mod tests {
    use super::*;
    use bh_core::types::{BodyCapture, HttpRequest};

    fn req(_id: u64, path: &str) -> HttpRequest {
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
        let q = ReqQuery { status: StatusFilter::All, ..ReqQuery::default() };
        let all = s.query_requests(&q);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].response.as_ref().unwrap().status, 200);
    }

    fn started_with_body(id: u64, size: usize) -> TrafficEvent {
        TrafficEvent::ExchangeStarted {
            id,
            request: HttpRequest {
                body: Some(BodyCapture::from_bytes(&vec![b'a'; size], None, 4096)),
                ..req(id, "/upload")
            },
        }
    }

    #[test]
    fn session_totals_accumulate_with_idempotence() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started_with_body(1, 25));
        s.ingest_traffic(&started(2, "/ok"));
        s.ingest_traffic(&completed(1, 200));
        s.ingest_traffic(&completed(1, 200));
        s.ingest_traffic(&completed(2, 500));
        s.ingest_traffic(&TrafficEvent::ExchangeFailed { id: 2, error: "late".into() });
        let st = s.session_totals();
        assert_eq!(st.count, 2);
        assert_eq!(st.failed, 1);
        assert_eq!(st.wire_bytes_in, 4);
        assert_eq!(st.bytes_out, 25);
    }

    #[test]
    fn failed_event_counts_once_without_response() {
        let s = AgentStore::new(AgentLimits::default());
        s.ingest_traffic(&started(3, "/crash"));
        s.ingest_traffic(&TrafficEvent::ExchangeFailed { id: 3, error: "reset".into() });
        s.ingest_traffic(&TrafficEvent::ExchangeFailed { id: 3, error: "dup".into() });
        assert_eq!(s.session_totals().failed, 1);
    }

    #[test]
    fn top_domains_orders_by_wire_bytes_then_host() {
        let mk = |host: &str, wire: u64, status: u16, total: u64| HttpExchange {
            id: 0,
            request: HttpRequest {
                method: "GET".into(),
                url: format!("https://{host}/p"),
                host: host.into(),
                path: "/p".into(),
                headers: vec![],
                body: None,
                started_at: 0.0,
            },
            response: Some(bh_core::types::HttpResponse {
                status,
                headers: vec![],
                body: Some(BodyCapture::from_bytes(&vec![b'x'; wire as usize], None, 4096)),
                ended_at: 1.0,
            }),
            error: None,
            timing: bh_core::types::Timing { ttfb_ms: None, download_ms: None, total_ms: Some(total) },
            protocol: String::new(),
        };
        let rows = vec![
            mk("big.com", 500, 200, 10),
            mk("big.com", 100, 500, 300),
            mk("small.com", 50, 200, 20),
            mk("small.com", 50, 200, 40),
        ];
        let top = top_domains(rows.iter(), 10);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].host, "big.com");
        assert_eq!(top[0].wire_bytes_in, 600);
        assert_eq!(top[0].failed, 1);
        assert_eq!(top[0].p95_ms, Some(300));
        assert_eq!(top[1].host, "small.com");
        assert_eq!(top[1].p95_ms, Some(40));
        assert!(top_domains(rows.iter(), 1).len() == 1);
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
        s.set_target(Some("emu".into()), None);
        s.ingest_traffic(&started(1, "/x"));
        s.pin_request(1);
        s.clear_pins();
        let f = s.focus();
        assert_eq!(f["pinned_requests"].as_array().unwrap().len(), 0);
    }
}
