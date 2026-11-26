use crate::batch::BatchSink;
use crate::console::{ConsoleBatchSink, ShellBatchSink};
use bh_console::{LogFilter, SessionHandle, ShellHandle};
use bh_device::RealRunner;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;

type RouteChange = Result<
    (crate::discovery::RouteFilesUpdate, crate::config::UiConfig),
    crate::discovery::RouteConfigError,
>;

pub struct AppState {
    runner: AsyncMutex<Option<Arc<RealRunner>>>,
    pub proxy: AsyncMutex<Option<bh_proxy::ProxyHandle>>,
    pub sink: StdMutex<Arc<BatchSink>>,
    pub active_serial: AsyncMutex<Option<String>>,
    pub metro_task: AsyncMutex<Option<crate::metro::MetroTaskHandle>>,
    pub tunnel_task: AsyncMutex<Option<crate::metro::MetroTaskHandle>>,
    pub routes: bh_proxy::SharedRoutes,
    pub route_catalog: AsyncMutex<Option<crate::routes::RouteCatalog>>,
}

impl AppState {
    pub fn new(sink: Arc<BatchSink>) -> Self {
        AppState {
            runner: AsyncMutex::new(None),
            proxy: AsyncMutex::new(None),
            sink: StdMutex::new(sink),
            active_serial: AsyncMutex::new(None),
            metro_task: AsyncMutex::new(None),
            tunnel_task: AsyncMutex::new(None),
            routes: bh_proxy::SharedRoutes::default(),
            route_catalog: AsyncMutex::new(None),
        }
    }

    pub fn current_sink(&self) -> Arc<BatchSink> {
        self.sink.lock().unwrap().clone()
    }

    pub fn restart_sink(&self, app: &tauri::AppHandle) -> Arc<BatchSink> {
        let agent = app
            .try_state::<AgentState>()
            .map(|a: tauri::State<AgentState>| a.store.clone());
        let sink = Arc::new(BatchSink::spawn(app.clone(), agent));
        *self.sink.lock().unwrap() = sink.clone();
        sink
    }

    pub async fn refresh_routes(
        &self,
        paths: &[String],
        force: bool,
    ) -> Vec<crate::routes::RouteFileStatus> {
        let mut catalog = self.route_catalog.lock().await;
        crate::routes::refresh(&self.routes, &mut catalog, paths, force).await;
        crate::routes::snapshot(&self.routes, &catalog)
    }

    pub async fn connect_route_file(
        &self,
        dir: &std::path::Path,
        path: &str,
        replaces: &[String],
    ) -> RouteChange {
        let mut catalog = self.route_catalog.lock().await;
        let (update, config) = crate::discovery::connect(dir, path, replaces).await?;
        crate::routes::apply(&self.routes, &mut catalog, &update.files, &update.reset).await;
        Ok((update, config))
    }

    pub async fn remove_route_file(&self, dir: &std::path::Path, path: &str) -> RouteChange {
        let mut catalog = self.route_catalog.lock().await;
        let (update, config) = crate::discovery::remove(dir, path)?;
        crate::routes::apply(&self.routes, &mut catalog, &update.files, &update.reset).await;
        Ok((update, config))
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
