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
