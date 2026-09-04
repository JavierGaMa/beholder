use crate::console::ShellBatchSink;
use crate::state::{AppState, ConsoleState, ShellSlot};
use bh_console::{AdbLogcatFactory, ConsoleSink, LogBuffer, LogFilter, LogSession, PtyShell, adb_shell_command};
use bh_core::{har_to_string, to_curl, HttpExchange};
use bh_device::{
    accept_licenses, create_avd_with_stdin, find_aapt, launch_emulator_detached, read_apk_package,
    ApkInstaller, AvdManager, CertificateInstaller, CommandRunner, DeviceScanner, DeviceState,
    ProxyConfigurator, RealSdkRunner, SdkTool,
};
use std::path::Path;
use tauri::{Emitter, Manager, State};

#[tauri::command]
pub async fn adb_status() -> Result<String, String> {
    bh_device::RealRunner::discover()
        .map(|r| r.adb_path().display().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_apks(app: tauri::AppHandle) -> Result<Vec<crate::apks::ApkEntry>, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let cfg = crate::config::load(&dir).map_err(|e| e.to_string())?;
    if cfg.apks.list_url.trim().is_empty() {
        return Err(crate::apks::UNCONFIGURED_ERROR.to_string());
    }
    crate::apks::list_apks(&cfg.apks.list_url).await
}

#[tauri::command]
pub async fn test_apks_list_url(
    list_url: String,
) -> Result<crate::apks::TestApksListResult, String> {
    Ok(crate::apks::count_listed_apks(&list_url).await)
}

#[tauri::command]
pub async fn set_apks_config(app: tauri::AppHandle, list_url: String) -> Result<(), String> {
    let normalized = crate::apks::normalize_list_url(&list_url)?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let cfg = crate::config::load(&dir).map_err(|e| e.to_string())?;
    if cfg.apks.list_url != normalized {
        let mut next = cfg.clone();
        next.apks.list_url = normalized;
        crate::config::write_config(&dir, &next).map_err(|e| e.to_string())?;
        let _ = app.emit("config-changed", &next);
    }
    Ok(())
}

#[tauri::command]
pub async fn download_apk(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<String, String> {
    crate::apks::download_apk(&app, &url, &name).await
}

#[tauri::command]
pub async fn install_apk(state: State<'_, AppState>, serial: String, path: String) -> Result<(), String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
    let package = RealSdkRunner::discover()
        .ok()
        .and_then(|sdk| find_aapt(sdk.sdk_root()))
        .and_then(|aapt| read_apk_package(&aapt, Path::new(&path)).ok());
    if let Some(package) = package {
        let _ = ApkInstaller::uninstall(&device, &package);
    }
    ApkInstaller::install_apk(&device, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_devices(state: State<'_, AppState>) -> Result<Vec<bh_device::Device>, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let scanner = bh_device::AdbScanner::new(runner.as_ref());
    scanner.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn current_proxy(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Option<String>, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
    ProxyConfigurator::current_proxy(&device).map_err(|e| e.to_string())
}

fn emu_avd_name(runner: &std::sync::Arc<bh_device::RealRunner>, serial: &str) -> Option<String> {
    let out = runner.run(&["-s", serial, "emu", "avd", "name"]).ok()?;
    out.stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "OK")
        .map(|s| s.to_string())
}

#[tauri::command]
pub async fn list_avds(state: State<'_, AppState>) -> Result<Vec<bh_device::AvdInfo>, String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    let manager = AvdManager::new(&sdk);
    let mut avds = manager.list_avds().map_err(|e| e.to_string())?;
    if let Ok(runner) = state.get_runner().await {
        let scanner = bh_device::AdbScanner::new(runner.as_ref());
        if let Ok(devices) = scanner.list() {
            for d in devices
                .iter()
                .filter(|d| d.is_emulator && d.state == DeviceState::Online)
            {
                if let Some(name) = emu_avd_name(&runner, &d.serial) {
                    if let Some(avd) = avds.iter_mut().find(|a| a.name.eq_ignore_ascii_case(&name))
                    {
                        avd.running = true;
                        avd.serial = Some(d.serial.clone());
                    }
                }
            }
        }
    }
    Ok(avds)
}

#[tauri::command]
pub async fn resolve_serial_for_avd(
    state: State<'_, AppState>,
    name: String,
) -> Result<String, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let scanner = bh_device::AdbScanner::new(runner.as_ref());
    let devices = scanner.list().map_err(|e| e.to_string())?;
    for d in devices
        .iter()
        .filter(|d| d.is_emulator && d.state == DeviceState::Online)
    {
        if let Some(avd) = emu_avd_name(&runner, &d.serial) {
            if avd.eq_ignore_ascii_case(&name) {
                return Ok(d.serial.clone());
            }
        }
    }
    Err("emulator is not visible to adb yet".into())
}

#[tauri::command]
pub async fn wait_booted(state: State<'_, AppState>, serial: String) -> Result<(), String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
        if device.boot_completed().unwrap_or(false) {
            return Ok(());
        }
        if start.elapsed() >= std::time::Duration::from_secs(180) {
            return Err("emulator did not finish booting within 3 minutes".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

#[tauri::command]
pub async fn launch_avd(name: String) -> Result<(), String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    launch_emulator_detached(&sdk, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<bh_device::SystemImage>, String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    let manager = AvdManager::new(&sdk);
    manager.list_images().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_device_profiles() -> Result<Vec<String>, String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    let manager = AvdManager::new(&sdk);
    manager.list_device_profiles().map_err(|e| e.to_string())
}

async fn stream_process<F>(bin: &Path, args: &[&str], on_line: F) -> Result<(bool, String), String>
where
    F: Fn(&str) + Send + Sync + 'static,
{
    use tokio::io::AsyncReadExt;

    let mut child = tokio::process::Command::new(bin)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut stdout = child.stdout.take().ok_or("no stdout".to_string())?;
    let mut stderr = child.stderr.take().ok_or("no stderr".to_string())?;

    let on_out = std::sync::Arc::new(on_line);
    let on_err = on_out.clone();

    let emit_task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for &b in &buf[..n] {
                        if b == b'\r' || b == b'\n' {
                            let s = String::from_utf8_lossy(&line).trim().to_string();
                            if !s.is_empty() {
                                on_out(&s);
                            }
                            line.clear();
                        } else {
                            line.push(b);
                        }
                    }
                }
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut err_buf = [0u8; 4096];
        let mut err_all = String::new();
        let mut line: Vec<u8> = Vec::new();
        loop {
            match stderr.read(&mut err_buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    err_all.push_str(&String::from_utf8_lossy(&err_buf[..n]));
                    for &b in &err_buf[..n] {
                        if b == b'\r' || b == b'\n' {
                            let s = String::from_utf8_lossy(&line).trim().to_string();
                            if !s.is_empty() {
                                on_err(&s);
                            }
                            line.clear();
                        } else {
                            line.push(b);
                        }
                    }
                }
            }
        }
        err_all
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = emit_task.await;
    let stderr = stderr_task.await.unwrap_or_default();

    Ok((status.success(), stderr))
}

async fn run_sdkmanager_streaming(
    app: &tauri::AppHandle,
    bin: &Path,
    args: &[&str],
) -> Result<bool, String> {
    let app_out = app.clone();
    let (ok, stderr) = stream_process(bin, args, move |line: &str| {
        let _ = app_out.emit("install-log", line.to_string());
    })
    .await?;

    if ok {
        Ok(true)
    } else if stderr.to_lowercase().contains("license") {
        Ok(false)
    } else {
        Err(if stderr.trim().is_empty() {
            "sdkmanager exited with an error".to_string()
        } else {
            stderr.trim().to_string()
        })
    }
}

#[tauri::command]
pub async fn install_image(app: tauri::AppHandle, pkg: String) -> Result<(), String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    let sdkmanager = sdk.tool_path(SdkTool::SdkManager).to_path_buf();
    let _ = app.emit(
        "install-log",
        format!("installing {} (this can take a while)...", pkg),
    );

    match run_sdkmanager_streaming(&app, &sdkmanager, &[&pkg]).await {
        Ok(true) => {
            let _ = app.emit("install-log", "done".to_string());
            Ok(())
        }
        Ok(false) => {
            let _ = app.emit("install-log", "accepting sdk licenses...".to_string());
            accept_licenses(&sdkmanager).map_err(|e| e.to_string())?;
            match run_sdkmanager_streaming(&app, &sdkmanager, &[&pkg]).await {
                Ok(true) => {
                    let _ = app.emit("install-log", "done".to_string());
                    Ok(())
                }
                Ok(false) => Err("license acceptance failed".to_string()),
                Err(e) => Err(e),
            }
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn create_avd(name: String, pkg: String, profile: String) -> Result<(), String> {
    let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
    create_avd_with_stdin(sdk.tool_path(SdkTool::AvdManager), &name, &pkg, &profile)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_stale_proxies(state: State<'_, AppState>) -> Result<u32, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let scanner = bh_device::AdbScanner::new(runner.as_ref());
    let devices = scanner.list().map_err(|e| e.to_string())?;
    let active = state.proxy.lock().await.as_ref().map(|h| h.port);
    let mut cleared = 0;
    for d in devices
        .iter()
        .filter(|d| d.is_emulator && d.state == DeviceState::Online)
    {
        let device = bh_device::AdbDevice::new(runner.as_ref(), &d.serial);
        if let Ok(Some(proxy)) = ProxyConfigurator::current_proxy(&device) {
            if let Some(port) = proxy.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
                if Some(port) != active && !port_alive(port) {
                    let _ = ProxyConfigurator::clear_proxy(&device);
                    cleared += 1;
                }
            }
        }
    }
    Ok(cleared)
}

#[tauri::command]
pub async fn run_doctor(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
) -> Result<Vec<bh_device::DoctorCheck>, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ca_installed = bh_ca::load_or_create(&dir).ok().and_then(|ca| {
        bh_ca::system_cert_filename(&ca.cert_pem).ok().map(|name| {
            bh_device::AdbDevice::new(runner.as_ref(), &serial)
                .is_cert_installed(&name, &ca.cert_pem)
                .unwrap_or(false)
        })
    });
    let active_port = state.proxy.lock().await.as_ref().map(|h| h.port);
    let checks = bh_device::run_checks(
        runner.as_ref(),
        &serial,
        ca_installed,
        &port_alive,
        active_port,
    );
    Ok(checks)
}

fn port_alive(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

#[tauri::command]
pub async fn apply_doctor_fix(
    state: State<'_, AppState>,
    serial: String,
    fix: String,
) -> Result<(), String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let fix_id = match fix.as_str() {
        "clear_proxy" => bh_device::FixId::ClearProxy,
        "disable_airplane" => bh_device::FixId::DisableAirplane,
        "clear_private_dns" => bh_device::FixId::ClearPrivateDns,
        "reboot" => bh_device::FixId::Reboot,
        other => return Err(format!("unknown fix: {other}")),
    };
    bh_device::apply_basic_fix(runner.as_ref(), &serial, fix_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_config(app: tauri::AppHandle) -> Result<crate::config::UiConfig, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    crate::config::load(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_config(
    app: tauri::AppHandle,
    config: crate::config::UiConfig,
) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    crate::config::write_config(&dir, &config).map_err(|e| e.to_string())?;
    use tauri::Emitter;
    let _ = app.emit("config-changed", &config);
    Ok(())
}

#[tauri::command]
pub async fn reveal_config(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let path = crate::config::config_path(&dir);
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn capture_start(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    port: Option<u16>,
    body_cap: Option<usize>,
) -> Result<u16, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ca = bh_ca::load_or_create(&dir).map_err(|e| e.to_string())?;
    let filename = bh_ca::system_cert_filename(&ca.cert_pem).map_err(|e| e.to_string())?;

    let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
    let installed = device
        .is_cert_installed(&filename, &ca.cert_pem)
        .map_err(|e| e.to_string())?;
    if !installed {
        device.root().map_err(|e| e.to_string())?;
        CertificateInstaller::install_system_cert(&device, &filename, &ca.cert_pem)
            .map_err(|e| e.to_string())?;
    }

    let port = match port {
        Some(p) => p,
        None => std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map_err(|e| e.to_string())?
            .port(),
    };
    let cap = body_cap.unwrap_or(2 * 1024 * 1024);
    let handle = bh_proxy::start_mitm(port, &ca, cap, state.sink.clone())
        .await
        .map_err(|e| e.to_string())?;

    device
        .set_proxy("10.0.2.2", port)
        .map_err(|e| e.to_string())?;
    *state.active_serial.lock().await = Some(serial.clone());
    if let Some(agent) = app.try_state::<crate::state::AgentState>() {
        agent
            .store
            .set_target(Some(serial.clone()), emu_avd_name(&runner, &serial));
        agent.store.set_capture(true);
    }
    state.proxy.lock().await.replace(handle);
    Ok(port)
}

#[tauri::command]
pub async fn capture_stop(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if let Some(handle) = state.proxy.lock().await.take() {
        handle.stop().await;
    }
    let serial = state.active_serial.lock().await.take();
    if let Some(serial) = serial {
        if let Ok(runner) = state.get_runner().await {
            let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
            let _ = ProxyConfigurator::clear_proxy(&device);
        }
    }
    if let Some(agent) = app.try_state::<crate::state::AgentState>() {
        agent.store.set_capture(false);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_pin_request(agent: State<'_, crate::state::AgentState>, id: u64) -> Result<(), String> {
    agent.store.pin_request(id);
    Ok(())
}

#[tauri::command]
pub fn agent_unpin_request(
    agent: State<'_, crate::state::AgentState>,
    id: u64,
) -> Result<(), String> {
    agent.store.unpin_request(id);
    Ok(())
}

#[tauri::command]
pub fn agent_pin_log(
    agent: State<'_, crate::state::AgentState>,
    line: bh_console::LogLine,
) -> Result<(), String> {
    agent.store.pin_log(line);
    Ok(())
}

#[tauri::command]
pub fn agent_clear_pins(agent: State<'_, crate::state::AgentState>) -> Result<(), String> {
    agent.store.clear_pins();
    Ok(())
}

#[tauri::command]
pub fn agent_set_focus_app(
    agent: State<'_, crate::state::AgentState>,
    package: Option<String>,
) -> Result<(), String> {
    agent.store.set_focus_app(package);
    Ok(())
}

#[derive(Debug, serde::Serialize)]
pub struct AgentBridgeStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    pub discovery_path: String,
    pub focus_app: Option<String>,
    pub pins_count: u64,
}

#[tauri::command]
pub async fn agent_set_enabled(
    app: tauri::AppHandle,
    agent: State<'_, crate::state::AgentState>,
    enabled: bool,
) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let cfg = crate::config::load(&dir).map_err(|e| e.to_string())?;
    if cfg.agent.enabled != enabled {
        let mut next = cfg.clone();
        next.agent.enabled = enabled;
        crate::config::write_config(&dir, &next).map_err(|e| e.to_string())?;
        let _ = app.emit("config-changed", &next);
    }
    let mut server = agent.server.lock().await;
    if enabled {
        if server.is_none() {
            let handle = bh_agent::serve_with(
                agent.store.clone(),
                &cfg.agent.bind,
                &agent.token,
                Some(bh_agent::discovery_path()),
            )
            .await
            .map_err(|e| e.to_string())?;
            *server = Some(handle);
        }
    } else {
        if let Some(handle) = server.take() {
            handle.shutdown().await;
        }
        let _ = std::fs::remove_file(bh_agent::discovery_path());
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_bridge_status(
    agent: State<'_, crate::state::AgentState>,
) -> Result<AgentBridgeStatus, String> {
    let server = agent.server.lock().await;
    Ok(AgentBridgeStatus {
        enabled: server.is_some(),
        port: server.as_ref().map(|h| h.port),
        discovery_path: bh_agent::discovery_path().display().to_string(),
        focus_app: agent.store.focus_app(),
        pins_count: agent.store.pins_count() as u64,
    })
}

fn resolve_mcp_binary() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join("beholder-mcp");
            if sibling.is_file() {
                return sibling.display().to_string();
            }
            let sibling_exe = dir.join("beholder-mcp.exe");
            if sibling_exe.is_file() {
                return sibling_exe.display().to_string();
            }
        }
    }
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
    for profile in ["release", "debug"] {
        let candidate = target.join(profile).join("beholder-mcp");
        if candidate.is_file() {
            return candidate
                .canonicalize()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| candidate.display().to_string());
        }
    }
    "beholder-mcp".into()
}

#[tauri::command]
pub async fn agent_mcp_config() -> Result<String, String> {
    let snippet = serde_json::json!({
        "mcpServers": {
            "beholder": { "command": resolve_mcp_binary() }
        }
    });
    serde_json::to_string_pretty(&snippet).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn format_curl(exchange: HttpExchange) -> Result<String, String> {
    Ok(to_curl(&exchange))
}

#[tauri::command]
pub async fn console_start(
    state: State<'_, AppState>,
    console: State<'_, ConsoleState>,
    serial: String,
    buffers: Vec<String>,
) -> Result<(), String> {
    if let Some(handle) = console.session.lock().await.take() {
        handle.stop();
    }
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let mut parsed: Vec<LogBuffer> = vec![];
    for b in &buffers {
        parsed.push(
            b.parse::<LogBuffer>()
                .map_err(|e| e.to_string())
                .map_err(|e| format!("unknown buffer '{b}': {e}"))?,
        );
    }
    if parsed.is_empty() {
        parsed = vec![LogBuffer::Main, LogBuffer::System, LogBuffer::Crash];
    }
    let filter = console.filter.lock().await.clone();
    let sink: std::sync::Arc<dyn ConsoleSink> = console.sink.clone();
    let handle = LogSession::spawn(
        Box::new(AdbLogcatFactory::new(runner.adb_path().clone())),
        serial,
        parsed,
        filter,
        sink,
    );
    *console.session.lock().await = Some(handle);
    Ok(())
}

#[tauri::command]
pub async fn console_stop(console: State<'_, ConsoleState>) -> Result<(), String> {
    if let Some(handle) = console.session.lock().await.take() {
        handle.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn console_set_filter(
    console: State<'_, ConsoleState>,
    filter: LogFilter,
) -> Result<(), String> {
    *console.filter.lock().await = filter.clone();
    if let Some(handle) = console.session.lock().await.as_ref() {
        handle.set_filter(filter);
    }
    Ok(())
}

#[tauri::command]
pub async fn console_apps(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Vec<bh_console::AppProcess>, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    bh_console::list_apps(runner.as_ref(), &serial).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn console_clear_buffer(
    state: State<'_, AppState>,
    serial: String,
) -> Result<(), String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let out = runner
        .run(&["-s", &serial, "logcat", "-c"])
        .map_err(|e| e.to_string())?;
    if !out.success {
        let stderr = out.stderr.trim();
        return Err(if stderr.is_empty() {
            format!("adb -s {serial} logcat -c failed")
        } else {
            stderr.to_string()
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn console_export(
    app: tauri::AppHandle,
    text: String,
    filename: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(filename)
        .add_filter("Text", &["txt", "log"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(chosen) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn console_shell_start(
    state: State<'_, AppState>,
    console: State<'_, ConsoleState>,
    app: tauri::AppHandle,
    serial: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let drain = {
        let mut guard = console.shell.lock().await;
        match guard.take() {
            Some(slot) => {
                let done = slot.sink.done.clone();
                slot.handle.kill();
                drop(slot);
                Some(done)
            }
            None => None,
        }
    };
    if let Some(done) = drain {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), done.notified()).await;
    }
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let sink = ShellBatchSink::spawn(app);
    let cmd = adb_shell_command(runner.adb_path(), &serial);
    let handle = PtyShell::spawn(cmd, rows, cols, sink.clone()).map_err(|e| e.to_string())?;
    *console.shell.lock().await = Some(ShellSlot {
        handle,
        sink,
        dead_reported: false,
    });
    Ok(())
}

#[tauri::command]
pub async fn console_shell_stop(console: State<'_, ConsoleState>) -> Result<(), String> {
    if let Some(slot) = console.shell.lock().await.take() {
        slot.handle.kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn console_shell_input(
    console: State<'_, ConsoleState>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let handle = {
        let mut guard = console.shell.lock().await;
        let Some(slot) = guard.as_mut() else {
            return Ok(());
        };
        if !slot.handle.is_running() {
            return if slot.dead_reported {
                Ok(())
            } else {
                slot.dead_reported = true;
                Err("shell exited".into())
            };
        }
        slot.handle.clone()
    };
    let write_result = tokio::task::spawn_blocking(move || handle.input(&bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string());
    match write_result {
        Ok(()) => Ok(()),
        Err(_) => {
            let mut guard = console.shell.lock().await;
            let Some(slot) = guard.as_mut() else {
                return Ok(());
            };
            if slot.dead_reported {
                return Ok(());
            }
            slot.dead_reported = true;
            Err("shell exited".into())
        }
    }
}

#[tauri::command]
pub async fn console_shell_resize(
    console: State<'_, ConsoleState>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let guard = console.shell.lock().await;
    if let Some(slot) = guard.as_ref() {
        slot.handle.resize(rows, cols);
    }
    Ok(())
}

#[tauri::command]
pub fn export_har(exchanges: Vec<HttpExchange>) -> Result<String, String> {
    Ok(har_to_string(&exchanges))
}

#[tauri::command]
pub fn export_postman(
    exchanges: Vec<HttpExchange>,
    name: Option<String>,
) -> Result<String, String> {
    let name = name.unwrap_or_else(|| "Beholder export".to_string());
    Ok(bh_core::postman_collection_to_string(&exchanges, &name))
}

#[tauri::command]
pub fn export_bruno_folder(
    exchanges: Vec<HttpExchange>,
    dir: String,
    name: Option<String>,
) -> Result<usize, String> {
    let name = name.unwrap_or_else(|| "Beholder capture".to_string());
    let files = bh_core::build_bruno_collection(&exchanges, &name);
    let root = std::path::Path::new(&dir);
    let mut written = 0;
    for file in &files {
        let path = root.join(&file.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &file.content).map_err(|e| e.to_string())?;
        written += 1;
    }
    Ok(written)
}

#[tauri::command]
pub async fn full_cleanup(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    capture_stop(state.clone(), app.clone()).await?;
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    if let Ok(ca) = bh_ca::load_or_create(&dir) {
        if let Ok(name) = bh_ca::system_cert_filename(&ca.cert_pem) {
            let serials = {
                let scanner = bh_device::AdbScanner::new(runner.as_ref());
                scanner.list().map_err(|e| e.to_string())?
            };
            for d in serials.into_iter().filter(|d| d.is_emulator) {
                let device = bh_device::AdbDevice::new(runner.as_ref(), &d.serial);
                let _ = CertificateInstaller::uninstall_cert(&device, &name);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::stream_process;
    use std::sync::Mutex;

    #[tokio::test]
    async fn streams_lines_split_on_cr_and_ln() {
        let lines = std::sync::Arc::new(Mutex::new(Vec::new()));
        let captured = lines.clone();
        let sink = move |l: &str| captured.lock().unwrap().push(l.to_string());
        let (ok, _stderr) = stream_process(
            std::path::Path::new("/bin/sh"),
            &["-c", "printf 'downloading 10%%\\rdownloading 50%%\\rwarning to stderr\\n' ; echo 'err line' >&2 ; exit 0"],
            sink,
        )
        .await
        .unwrap();
        assert!(ok);
        let got = lines.lock().unwrap().clone();
        assert!(got.contains(&"downloading 10%".to_string()));
        assert!(got.contains(&"downloading 50%".to_string()));
        assert!(got.contains(&"warning to stderr".to_string()));
        assert!(got.contains(&"err line".to_string()));
    }

    #[tokio::test]
    async fn reports_failure_and_stderr() {
        let (_ok, stderr) = stream_process(
            std::path::Path::new("/bin/sh"),
            &["-c", "echo 'license not accepted' >&2 ; exit 1"],
            |_| {},
        )
        .await
        .unwrap();
        assert!(stderr.contains("license not accepted"));
    }
}
