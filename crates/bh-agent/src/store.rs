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
