use crate::batch::BatchSink;
use crate::console::{ConsoleBatchSink, ShellBatchSink};
use bh_console::{LogFilter, SessionHandle, ShellHandle};
use bh_device::RealRunner;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;

pub struct AppState {
    runner: AsyncMutex<Option<Arc<RealRunner>>>,
    pub proxy: AsyncMutex<Option<bh_proxy::ProxyHandle>>,
    pub sink: Arc<BatchSink>,
    pub active_serial: AsyncMutex<Option<String>>,
}

impl AppState {
    pub fn new(sink: Arc<BatchSink>) -> Self {
        AppState {
            runner: AsyncMutex::new(None),
            proxy: AsyncMutex::new(None),
            sink,
            active_serial: AsyncMutex::new(None),
        }
    }

    pub async fn get_runner(&self) -> Result<Arc<RealRunner>, bh_device::DeviceError> {
        let mut guard = self.runner.lock().await;
        if let Some(r) = guard.as_ref() {
            return Ok(r.clone());
        }
        let runner = Arc::new(RealRunner::discover()?);
        *guard = Some(runner.clone());
        Ok(runner)
    }
}

pub struct ShellSlot {
    pub handle: ShellHandle,
    pub sink: Arc<ShellBatchSink>,
    pub dead_reported: bool,
}

pub struct ConsoleState {
    pub sink: Arc<ConsoleBatchSink>,
    pub session: AsyncMutex<Option<SessionHandle>>,
    pub filter: AsyncMutex<LogFilter>,
    pub shell: AsyncMutex<Option<ShellSlot>>,
}

impl ConsoleState {
    pub fn new(sink: Arc<ConsoleBatchSink>) -> Self {
        ConsoleState {
            sink,
            session: AsyncMutex::new(None),
            filter: AsyncMutex::new(LogFilter::default()),
            shell: AsyncMutex::new(None),
        }
    }
}

pub struct AgentState {
    pub store: Arc<bh_agent::AgentStore>,
    pub server: AsyncMutex<Option<bh_agent::ServerHandle>>,
    pub token: String,
}
