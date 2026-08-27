use crate::batch::BatchSink;
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
