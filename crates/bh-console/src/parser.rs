use crate::types::{LogBuffer, LogLine, LogLevel};

pub struct LogParser {
    pending: Option<LogLine>,
    buffer: LogBuffer,
    now_ms: u64,
}

impl LogParser {
    pub fn new() -> Self {
        LogParser {
            pending: None,
            buffer: LogBuffer::Main,
            now_ms: system_now_ms(),
        }
    }

    pub fn with_now_ms(now_ms: u64) -> Self {
        LogParser {
            pending: None,
            buffer: LogBuffer::Main,
            now_ms,
        }
    }

    pub fn feed(&mut self, line: &str) -> Option<LogLine> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim().is_empty() {
            if let Some(p) = self.pending.as_mut() {
                p.message.push('\n');
            }
            return None;
        }
        if let Some(buffer) = parse_buffer_marker(line.trim()) {
            self.buffer = buffer;
            return self.pending.take();
        }
        match parse_header(line, self.now_ms) {
            Some(mut entry) => {
                entry.buffer = self.buffer;
                self.pending.replace(entry)
            }
            None => match self.pending.as_mut() {
                Some(prev) => {
                    prev.message.push('\n');
                    prev.message.push_str(line);
                    None
                }
                None => Some(LogLine {
                    ts_ms: 0,
                    level: LogLevel::Info,
                    pid: 0,
                    tid: 0,
                    tag: String::new(),
                    buffer: self.buffer,
                    message: line.to_string(),
                    is_crash: false,
                    repeat_count: 1,
                }),
            },
        }
    }

    pub fn finish(&mut self) -> Option<LogLine> {
        self.pending.take()
    }
}

impl Default for LogParser {
    fn default() -> Self {
        Self::new()
    }
}

fn system_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_header(line: &str, now_ms: u64) -> Option<LogLine> {
    let (ts_ms, rest) = parse_threadtime_prefix(line, now_ms)?;
    let (pid, rest) = parse_field_u32(rest)?;
    let (tid, rest) = parse_field_u32(rest)?;
    let (level_tok, rest) = parse_field(rest)?;
    let level = parse_level(level_tok)?;
    let (tag_tok, rest) = parse_field(rest)?;
    let tag = tag_tok.strip_suffix(':').unwrap_or(tag_tok);
    let message = rest.trim_start();
    let is_crash = (level == LogLevel::Error && message.starts_with("FATAL EXCEPTION"))
        || message.starts_with("ANR in ");
    let repeat_count = if tag.eq_ignore_ascii_case("chatty") {
        chatty_repeat(message).unwrap_or(1)
    } else {
        1
    };
    Some(LogLine {
        ts_ms,
        level,
        pid,
        tid,
        tag: tag.to_string(),
        buffer: LogBuffer::Main,
        message: message.to_string(),
        is_crash,
        repeat_count,
    })
}

fn parse_threadtime_prefix(line: &str, now_ms: u64) -> Option<(u64, &str)> {
    let s = line.trim_start();
    let b = s.as_bytes();
    let month = two_digits(b, 0)?;
    if b.get(2) != Some(&b'-') {
        return None;
    }
    let day = two_digits(b, 3)?;
    if !b.get(5).is_some_and(u8::is_ascii_whitespace) {
        return None;
    }
    let hour = two_digits(b, 6)?;
    if b.get(8) != Some(&b':') {
        return None;
    }
    let minute = two_digits(b, 9)?;
    if b.get(11) != Some(&b':') {
        return None;
    }
    let second = two_digits(b, 12)?;
    if b.get(14) != Some(&b'.') {
        return None;
    }
    let millis = two_digits(b, 15)? * 10 + one_digit(b, 17)?;
    if !b.get(18).is_some_and(u8::is_ascii_whitespace) {
        return None;
    }
    let rest = s.get(19..)?;
    let year = current_year(now_ms);
    let mut ts = civil_ms(year, month, day, hour, minute, second, millis);
    if ts > now_ms.saturating_add(86_400_000) {
        ts = civil_ms(year - 1, month, day, hour, minute, second, millis);
    }
    Some((ts, rest))
}

fn parse_field(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    if s.is_empty() {
        return None;
    }
    match s.find(char::is_whitespace) {
        Some(i) => Some((&s[..i], &s[i..])),
        None => Some((s, "")),
    }
}

fn parse_field_u32(s: &str) -> Option<(u32, &str)> {
    let (tok, rest) = parse_field(s)?;
    Some((tok.parse().ok()?, rest))
}

fn parse_level(tok: &str) -> Option<LogLevel> {
    match tok {
        "V" => Some(LogLevel::Verbose),
        "D" => Some(LogLevel::Debug),
        "I" => Some(LogLevel::Info),
        "W" => Some(LogLevel::Warn),
        "E" => Some(LogLevel::Error),
        "F" => Some(LogLevel::Fatal),
        _ => None,
    }
}

fn parse_buffer_marker(line: &str) -> Option<LogBuffer> {
    let rest = line.strip_prefix("--------- beginning of ")?;
    rest.trim().parse().ok()
}

fn chatty_repeat(message: &str) -> Option<u32> {
    let parts: Vec<&str> = message.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let count = parts[parts.len() - 2].parse::<u32>().ok()?;
    if !parts[parts.len() - 1].eq_ignore_ascii_case("lines") {
        return None;
    }
    parts[..parts.len() - 2]
        .iter()
        .any(|p| {
            matches!(
                p.to_ascii_lowercase().as_str(),
                "identical" | "ident" | "expire" | "expunge"
            )
        })
        .then_some(count)
}

fn one_digit(b: &[u8], i: usize) -> Option<u32> {
    let c = *b.get(i)?;
    if c.is_ascii_digit() {
        Some((c - b'0') as u32)
    } else {
        None
    }
}

fn two_digits(b: &[u8], i: usize) -> Option<u32> {
    Some(one_digit(b, i)? * 10 + one_digit(b, i + 1)?)
}

fn current_year(now_ms: u64) -> i64 {
    civil_from_days((now_ms / 86_400_000) as i64).0
}

fn civil_ms(year: i64, month: u32, day: u32, hour: u32, minute: u32, second: u32, millis: u32) -> u64 {
    let days = days_from_civil(year, month, day);
    let secs = days * 86400 + (hour as i64 * 3600 + minute as i64 * 60 + second as i64);
    (secs * 1000 + millis as i64) as u64
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((m + 9) % 12) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_now() -> u64 {
        civil_ms(2026, 8, 28, 12, 0, 0, 0)
    }

    fn drain(lines: &[&str]) -> Vec<LogLine> {
        let mut parser = LogParser::with_now_ms(fixed_now());
        let mut out = vec![];
        for l in lines {
            if let Some(e) = parser.feed(l) {
                out.push(e);
            }
        }
        if let Some(e) = parser.finish() {
            out.push(e);
        }
        out
    }

    #[test]
    fn parses_normal_header() {
        let out = drain(&["08-28 11:00:00.123  4521  4521 I ReactNativeJS: started"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].ts_ms, civil_ms(2026, 8, 28, 11, 0, 0, 123));
        assert_eq!(out[0].level, LogLevel::Info);
        assert_eq!(out[0].pid, 4521);
        assert_eq!(out[0].tid, 4521);
        assert_eq!(out[0].tag, "ReactNativeJS");
        assert_eq!(out[0].message, "started");
        assert_eq!(out[0].buffer, LogBuffer::Main);
        assert!(!out[0].is_crash);
        assert_eq!(out[0].repeat_count, 1);
    }

    #[test]
    fn tolerates_padded_fields_and_leading_space() {
        let out = drain(&["   08-28 11:00:00.123     1    2   W   Tag:   msg here"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].pid, 1);
        assert_eq!(out[0].tid, 2);
        assert_eq!(out[0].level, LogLevel::Warn);
        assert_eq!(out[0].tag, "Tag");
        assert_eq!(out[0].message, "msg here");
    }

    #[test]
    fn keeps_header_message_spacing() {
        let out = drain(&["08-28 11:00:00.001  1  1 I T: a   b"]);
        assert_eq!(out[0].message, "a   b");
    }

    #[test]
    fn appends_continuations_to_previous_entry() {
        let out = drain(&[
            "08-28 11:00:00.100  4521  4521 E AndroidRuntime: FATAL EXCEPTION: main",
            "Process: com.example, PID: 4521",
            "java.lang.RuntimeException: boom",
            "  at com.foo.Bar.run(Bar.java:10)",
            "Caused by: java.lang.IllegalStateException: inner",
            "  at com.foo.Baz.run(Baz.java:20)",
            "08-28 11:00:00.200  4521  4521 I ActivityManager: after",
        ]);
        assert_eq!(out.len(), 2);
        assert!(out[0].is_crash);
        assert_eq!(
            out[0].message,
            "FATAL EXCEPTION: main\nProcess: com.example, PID: 4521\njava.lang.RuntimeException: boom\n  at com.foo.Bar.run(Bar.java:10)\nCaused by: java.lang.IllegalStateException: inner\n  at com.foo.Baz.run(Baz.java:20)"
        );
        assert!(!out[1].is_crash);
        assert_eq!(out[1].message, "after");
    }

    #[test]
    fn continuation_before_header_becomes_standalone_info_entry() {
        let out = drain(&["orphan continuation", "08-28 11:00:00.100  1  1 I Tag: real"]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].tag, "");
        assert_eq!(out[0].level, LogLevel::Info);
        assert_eq!(out[0].pid, 0);
        assert_eq!(out[0].tid, 0);
        assert_eq!(out[0].ts_ms, 0);
        assert_eq!(out[0].message, "orphan continuation");
    }

    #[test]
    fn flags_anr_messages_as_crash() {
        let out = drain(&[
            "08-28 11:00:00.100  1500  1500 E ActivityManager: ANR in com.example (com.example/.Main)",
            "08-28 11:00:00.101  1  1 I Tag: x",
        ]);
        assert!(out[0].is_crash);
        assert_eq!(out[0].level, LogLevel::Error);
    }

    #[test]
    fn parses_chatty_repeat_counts() {
        let out = drain(&[
            "08-28 11:00:00.100  1  1 I chatty: uid=1000(system) expire 3 lines",
            "08-28 11:00:00.101  1  1 W chatty: ident 12 lines",
            "08-28 11:00:00.102  1  1 I chatty: expunge 5 lines",
            "08-28 11:00:00.103  1  1 I chatty: uid=1000 com.example identical 20 lines",
            "08-28 11:00:00.104  1  1 I Tag: normal",
        ]);
        assert_eq!(out[0].repeat_count, 3);
        assert_eq!(out[1].repeat_count, 12);
        assert_eq!(out[2].repeat_count, 5);
        assert_eq!(out[3].repeat_count, 20);
        assert_eq!(out[4].repeat_count, 1);
    }

    #[test]
    fn parses_unknown_prefixed_tags() {
        let out = drain(&["08-28 11:00:00.100  1234  5678 E unknown:ReactNativeJS: json crash"]);
        assert_eq!(out[0].tag, "unknown:ReactNativeJS");
        assert_eq!(out[0].message, "json crash");
    }

    #[test]
    fn tracks_buffer_markers() {
        let out = drain(&[
            "--------- beginning of system",
            "08-28 11:00:00.100  1  1 I A: one",
            "--------- beginning of crash",
            "08-28 11:00:00.101  1  1 E B: two",
            "08-28 11:00:00.102  1  1 I C: three",
        ]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].buffer, LogBuffer::System);
        assert_eq!(out[1].buffer, LogBuffer::Crash);
        assert_eq!(out[2].buffer, LogBuffer::Crash);
    }

    #[test]
    fn defaults_to_main_buffer_before_first_marker() {
        let out = drain(&["08-28 11:00:00.100  1  1 I A: one"]);
        assert_eq!(out[0].buffer, LogBuffer::Main);
    }

    #[test]
    fn rolls_year_back_when_over_one_day_in_future() {
        let now = civil_ms(2027, 1, 1, 0, 0, 0, 0);
        let mut parser = LogParser::with_now_ms(now);
        parser.feed("12-31 23:59:59.999  1  1 I Tag: new year eve");
        let out = parser.finish().unwrap();
        assert_eq!(out.ts_ms, civil_ms(2026, 12, 31, 23, 59, 59, 999));
    }

    #[test]
    fn keeps_same_year_when_not_in_future() {
        let now = civil_ms(2026, 12, 31, 23, 59, 59, 999);
        let mut parser = LogParser::with_now_ms(now);
        parser.feed("12-31 23:59:59.999  1  1 I Tag: edge");
        let out = parser.finish().unwrap();
        assert_eq!(out.ts_ms, civil_ms(2026, 12, 31, 23, 59, 59, 999));
    }

    #[test]
    fn garbage_line_becomes_standalone_entry() {
        let out = drain(&["this is not logcat output"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].tag, "");
        assert_eq!(out[0].message, "this is not logcat output");
        assert_eq!(out[0].level, LogLevel::Info);
    }

    #[test]
    fn empty_line_dropped_before_header_and_kept_as_blank_continuation() {
        let mut parser = LogParser::with_now_ms(fixed_now());
        assert!(parser.feed("").is_none());
        assert!(parser.feed("   ").is_none());
        assert!(parser.finish().is_none());
        parser.feed("08-28 11:00:00.100  1  1 I Tag: start");
        assert!(parser.feed("").is_none());
        parser.feed("resume");
        let out = parser.finish().unwrap();
        assert_eq!(out.message, "start\n\nresume");
    }

    #[test]
    fn lowercase_level_is_continuation() {
        let out = drain(&[
            "08-28 11:00:00.100  1  1 I Tag: base",
            "08-28 11:00:00.101  1  1 i Tag: lower",
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].message, "base\n08-28 11:00:00.101  1  1 i Tag: lower");
    }

    #[test]
    fn strips_carriage_returns() {
        let out = drain(&["08-28 11:00:00.100  1  1 I Tag: crlf\r"]);
        assert_eq!(out[0].message, "crlf");
    }

    #[test]
    fn parses_all_levels() {
        for (tok, level) in [
            ("V", LogLevel::Verbose),
            ("D", LogLevel::Debug),
            ("I", LogLevel::Info),
            ("W", LogLevel::Warn),
            ("E", LogLevel::Error),
            ("F", LogLevel::Fatal),
        ] {
            let out = drain(&[&format!("08-28 11:00:00.100  1  1 {tok} Tag: m")]);
            assert_eq!(out[0].level, level);
        }
    }
}
