use crate::logcat::{ConsoleSink, LogStreamFactory};
use crate::parser::LogParser;
use crate::types::{ConsoleEvent, LogBuffer, LogFilter, LogLine, LogStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

pub trait RetryPolicy: Send + Sync {
    fn delay_for(&self, attempt: u32) -> Duration;
}

pub struct FixedRetryPolicy;

impl RetryPolicy for FixedRetryPolicy {
    fn delay_for(&self, attempt: u32) -> Duration {
        match attempt {
            0 => Duration::from_secs(1),
            1 => Duration::from_secs(2),
            2 => Duration::from_secs(5),
            _ => Duration::from_secs(10),
        }
    }
}

pub struct SessionHandle {
    stop: Arc<AtomicBool>,
    filter: Arc<RwLock<LogFilter>>,
}

impl SessionHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        !self.stop.load(Ordering::SeqCst)
    }

    pub fn set_filter(&self, filter: LogFilter) {
        *self.filter.write().unwrap() = filter;
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub struct LogSession;

impl LogSession {
    pub fn spawn(
        factory: Box<dyn LogStreamFactory>,
        serial: String,
        buffers: Vec<LogBuffer>,
        filter: LogFilter,
        sink: Arc<dyn ConsoleSink>,
    ) -> SessionHandle {
        Self::spawn_with_retry(
            factory,
            serial,
            buffers,
            filter,
            sink,
            Box::new(FixedRetryPolicy),
        )
    }

    pub fn spawn_with_retry(
        factory: Box<dyn LogStreamFactory>,
        serial: String,
        buffers: Vec<LogBuffer>,
        filter: LogFilter,
        sink: Arc<dyn ConsoleSink>,
        retry: Box<dyn RetryPolicy>,
    ) -> SessionHandle {
        let stop = Arc::new(AtomicBool::new(false));
        let shared_filter = Arc::new(RwLock::new(filter));
        let handle = SessionHandle {
            stop: stop.clone(),
            filter: shared_filter.clone(),
        };
        std::thread::spawn(move || {
            run(factory, serial, buffers, shared_filter, sink, stop, retry);
        });
        handle
    }
}

fn run(
    factory: Box<dyn LogStreamFactory>,
    serial: String,
    buffers: Vec<LogBuffer>,
    filter: Arc<RwLock<LogFilter>>,
    sink: Arc<dyn ConsoleSink>,
    stop: Arc<AtomicBool>,
    retry: Box<dyn RetryPolicy>,
) {
    let mut attempt: u32 = 0;
    while !stop.load(Ordering::SeqCst) {
        match factory.open(&serial, &buffers) {
            Ok(mut stream) => {
                attempt = 0;
                sink.emit(ConsoleEvent::Status(LogStatus::Streaming));
                let mut parser = LogParser::new();
                loop {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Some(line) = stream.lines() else {
                        break;
                    };
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Some(entry) = parser.feed(&line) {
                        emit_if_passing(&filter, &entry, &sink);
                    }
                }
                drop(stream);
                if let Some(entry) = parser.finish() {
                    emit_if_passing(&filter, &entry, &sink);
                }
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                sink.emit(ConsoleEvent::Status(LogStatus::Disconnected));
            }
            Err(e) => {
                sink.emit(ConsoleEvent::Status(LogStatus::Failed(e.to_string())));
            }
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        sleep_interruptible(&stop, retry.delay_for(attempt));
        attempt += 1;
    }
    sink.emit(ConsoleEvent::Status(LogStatus::Stopped));
}

fn emit_if_passing(filter: &RwLock<LogFilter>, entry: &LogLine, sink: &Arc<dyn ConsoleSink>) {
    if filter_passes(&filter.read().unwrap(), entry) {
        sink.emit(ConsoleEvent::Line(entry.clone()));
    }
}

fn filter_passes(filter: &LogFilter, entry: &LogLine) -> bool {
    if let Some(pid) = filter.pid {
        if entry.pid != pid {
            return false;
        }
    }
    if let Some(min_level) = filter.min_level {
        if entry.level.rank() < min_level.rank() {
            return false;
        }
    }
    if !filter.tags.is_empty() {
        let matched = filter
            .tags
            .iter()
            .any(|t| t == &entry.tag || entry.tag.ends_with(&format!(":{t}")));
        if !matched {
            return false;
        }
    }
    true
}

fn sleep_interruptible(stop: &AtomicBool, total: Duration) {
    let mut remaining = total;
    let step = Duration::from_millis(20);
    while !stop.load(Ordering::SeqCst) && !remaining.is_zero() {
        let chunk = remaining.min(step);
        std::thread::sleep(chunk);
        remaining = remaining.saturating_sub(chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logcat::{FakeLogStreamFactory, LogStream, RecordingConsoleSink};
    use crate::types::{ConsoleError, LogLevel};

    struct FastPolicy;
    impl RetryPolicy for FastPolicy {
        fn delay_for(&self, _attempt: u32) -> Duration {
            Duration::from_millis(5)
        }
    }

    struct HoldPolicy;
    impl RetryPolicy for HoldPolicy {
        fn delay_for(&self, _attempt: u32) -> Duration {
            Duration::from_secs(3600)
        }
    }

    struct SharedFactory<F: LogStreamFactory>(Arc<F>);
    impl<F: LogStreamFactory> LogStreamFactory for SharedFactory<F> {
        fn open(&self, serial: &str, buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError> {
            self.0.open(serial, buffers)
        }
    }

    struct GatedStream {
        rx: std::sync::mpsc::Receiver<String>,
    }

    impl LogStream for GatedStream {
        fn lines(&mut self) -> Option<String> {
            self.rx.recv().ok()
        }
    }

    struct GatedFactory {
        senders: Arc<std::sync::Mutex<Vec<std::sync::mpsc::Sender<String>>>>,
    }

    impl GatedFactory {
        fn new() -> (
            SharedFactory<Self>,
            Arc<std::sync::Mutex<Vec<std::sync::mpsc::Sender<String>>>>,
        ) {
            let senders = Arc::new(std::sync::Mutex::new(vec![]));
            (
                SharedFactory(Arc::new(GatedFactory {
                    senders: senders.clone(),
                })),
                senders,
            )
        }
    }

    impl LogStreamFactory for GatedFactory {
        fn open(&self, _serial: &str, _buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError> {
            let (tx, rx) = std::sync::mpsc::channel();
            self.senders.lock().unwrap().push(tx);
            Ok(Box::new(GatedStream { rx }))
        }
    }

    fn wait_for(timeout: Duration, f: impl Fn() -> bool) -> bool {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    fn statuses(sink: &RecordingConsoleSink) -> Vec<LogStatus> {
        sink.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ConsoleEvent::Status(s) => Some(s.clone()),
                _ => None,
            })
            .collect()
    }

    fn lines(sink: &RecordingConsoleSink) -> Vec<LogLine> {
        sink.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ConsoleEvent::Line(l) => Some(l.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn emits_streaming_then_lines_and_flushes_on_eof() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let factory = FakeLogStreamFactory::new();
        factory.push_lines(vec![
            "--------- beginning of main",
            "08-28 14:23:01.123  4521  4521 I ReactNativeJS: hello",
            "08-28 14:23:01.124  4521  4521 E AndroidRuntime: FATAL EXCEPTION: main",
            "  at com.foo.Bar.run(Bar.java:10)",
        ]);
        let handle = LogSession::spawn_with_retry(
            Box::new(factory),
            "emu".into(),
            vec![LogBuffer::Main],
            LogFilter::default(),
            sink.clone(),
            Box::new(FastPolicy),
        );
        assert!(wait_for(Duration::from_secs(2), || {
            lines(&sink).len() == 2 && statuses(&sink).len() >= 2
        }));
        handle.stop();
        assert!(wait_for(Duration::from_secs(2), || {
            statuses(&sink).last() == Some(&LogStatus::Stopped)
        }));
        let got = lines(&sink);
        assert_eq!(got[0].message, "hello");
        assert!(got[1].is_crash);
        assert_eq!(
            got[1].message,
            "FATAL EXCEPTION: main\n  at com.foo.Bar.run(Bar.java:10)"
        );
        let st = statuses(&sink);
        assert_eq!(st.first(), Some(&LogStatus::Streaming));
        assert!(st.contains(&LogStatus::Disconnected));
    }

    #[test]
    fn filters_lines_by_pid_level_and_tag() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let factory = FakeLogStreamFactory::new();
        factory.push_lines(vec![
            "--------- beginning of main",
            "08-28 14:23:01.100  4521  4521 V ReactNativeJS: verbose",
            "08-28 14:23:01.101  4521  4521 I ReactNativeJS: info",
            "08-28 14:23:01.102  4521  4521 W ReactNativeJS: warn",
            "08-28 14:23:01.103  9999  9999 W Other: other pid",
            "08-28 14:23:01.104  4521  4521 E unknown:ReactNativeJS: err",
        ]);
        let filter = LogFilter {
            pid: Some(4521),
            min_level: Some(LogLevel::Warn),
            tags: vec!["ReactNativeJS".into()],
        };
        let handle = LogSession::spawn_with_retry(
            Box::new(factory),
            "emu".into(),
            vec![],
            filter,
            sink.clone(),
            Box::new(FastPolicy),
        );
        assert!(wait_for(Duration::from_secs(2), || lines(&sink).len() == 2));
        handle.stop();
        let got = lines(&sink);
        assert_eq!(got[0].message, "warn");
        assert_eq!(got[0].level, LogLevel::Warn);
        assert_eq!(got[1].message, "err");
        assert_eq!(got[1].tag, "unknown:ReactNativeJS");
    }

    #[test]
    fn retries_after_eof_with_backoff() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let factory = Arc::new(FakeLogStreamFactory::new());
        factory.push_lines(vec!["08-28 14:23:01.100  1  1 I A: one"]);
        factory.push_lines(vec!["08-28 14:23:01.200  1  1 I B: two"]);
        let handle = LogSession::spawn_with_retry(
            Box::new(SharedFactory(factory.clone())),
            "emulator-5554".into(),
            vec![LogBuffer::Main],
            LogFilter::default(),
            sink.clone(),
            Box::new(FastPolicy),
        );
        assert!(wait_for(Duration::from_secs(2), || {
            factory.open_count() >= 2 && statuses(&sink).len() >= 4
        }));
        handle.stop();
        assert!(wait_for(Duration::from_secs(2), || {
            statuses(&sink).last() == Some(&LogStatus::Stopped)
        }));
        let st = statuses(&sink);
        assert_eq!(
            st[..4],
            vec![
                LogStatus::Streaming,
                LogStatus::Disconnected,
                LogStatus::Streaming,
                LogStatus::Disconnected,
            ]
        );
        assert!(factory.open_count() >= 2);
        let opens = factory.opens.lock().unwrap().clone();
        assert_eq!(opens[0], ("emulator-5554".to_string(), vec![LogBuffer::Main]));
    }

    #[test]
    fn reports_failed_open_and_keeps_retrying() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let factory = FakeLogStreamFactory::new();
        factory.push_error(ConsoleError::AdbNotFound("no adb here".into()));
        factory.push_lines(vec!["08-28 14:23:01.100  1  1 I A: one"]);
        let handle = LogSession::spawn_with_retry(
            Box::new(factory),
            "emu".into(),
            vec![],
            LogFilter::default(),
            sink.clone(),
            Box::new(FastPolicy),
        );
        assert!(
            wait_for(Duration::from_secs(2), || statuses(&sink).len() >= 3),
            "expected at least 3 statuses, got {:?}",
            statuses(&sink)
        );
        handle.stop();
        let st = statuses(&sink);
        assert!(matches!(&st[0], LogStatus::Failed(m) if m.contains("adb not found")));
        assert_eq!(st[1], LogStatus::Streaming);
        assert_eq!(st[2], LogStatus::Disconnected);
    }

    #[test]
    fn stop_interrupts_backoff_and_ends_loop() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let factory = Arc::new(FakeLogStreamFactory::new());
        factory.push_error(ConsoleError::Other("device offline".into()));
        let handle = LogSession::spawn_with_retry(
            Box::new(SharedFactory(factory.clone())),
            "emu".into(),
            vec![],
            LogFilter::default(),
            sink.clone(),
            Box::new(HoldPolicy),
        );
        assert!(wait_for(Duration::from_secs(2), || {
            !statuses(&sink).is_empty()
        }));
        assert!(handle.is_running());
        handle.stop();
        assert!(!handle.is_running());
        assert!(wait_for(Duration::from_secs(2), || {
            statuses(&sink).last() == Some(&LogStatus::Stopped)
        }));
        assert_eq!(factory.open_count(), 1);
    }

    #[test]
    fn updates_filter_live_without_restart() {
        let sink = Arc::new(RecordingConsoleSink::new());
        let (factory, senders) = GatedFactory::new();
        let handle = LogSession::spawn_with_retry(
            Box::new(factory),
            "emu".into(),
            vec![],
            LogFilter {
                pid: Some(4521),
                min_level: None,
                tags: vec![],
            },
            sink.clone(),
            Box::new(HoldPolicy),
        );
        assert!(wait_for(Duration::from_secs(2), || {
            statuses(&sink).first() == Some(&LogStatus::Streaming)
        }));
        let tx = senders.lock().unwrap().last().cloned().unwrap();
        tx.send("08-28 14:23:01.100  4521  4521 I Tag: one".to_string())
            .unwrap();
        tx.send("08-28 14:23:01.101  4521  4521 I Tag: two".to_string())
            .unwrap();
        assert!(
            wait_for(Duration::from_secs(2), || {
                lines(&sink).len() == 1
            }),
            "first entry should flush and pass pid filter"
        );
        handle.set_filter(LogFilter {
            pid: Some(9999),
            min_level: None,
            tags: vec![],
        });
        tx.send("08-28 14:23:01.200  4521  4521 I Tag: three".to_string())
            .unwrap();
        tx.send("08-28 14:23:01.300  9999  9999 I Tag: four".to_string())
            .unwrap();
        tx.send("08-28 14:23:01.400  9999  9999 I Tag: five".to_string())
            .unwrap();
        assert!(
            wait_for(Duration::from_secs(2), || {
                lines(&sink).len() == 2
            }),
            "old pid entries dropped, new pid entry emitted"
        );
        let got = lines(&sink);
        assert_eq!(got[0].message, "one");
        assert_eq!(got[0].pid, 4521);
        assert_eq!(got[1].message, "four");
        assert_eq!(got[1].pid, 9999);
        assert!(
            !statuses(&sink).contains(&LogStatus::Disconnected),
            "stream must not restart on filter change"
        );
        handle.stop();
        tx.send("08-28 14:23:01.500  9999  9999 I Tag: unblock".to_string())
            .unwrap();
        assert!(wait_for(Duration::from_secs(2), || {
            statuses(&sink).last() == Some(&LogStatus::Stopped)
        }));
    }
}
