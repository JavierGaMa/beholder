use crate::console::ShellBatchSink;
use crate::state::{AppState, ConsoleState, ShellSlot};
use bh_console::{AdbLogcatFactory, ConsoleSink, LogBuffer, LogFilter, LogSession, PtyShell, adb_shell_command};
use bh_core::{har_to_string, to_curl, HttpExchange};
use bh_device::{
    accept_licenses, create_avd_with_stdin, find_aapt, launch_emulator_detached, read_apk_package,
    ApkInstaller, AvdManager, CertificateInstaller, CommandRunner, DeviceScanner, DeviceState,
    ProxyConfigurator, RealSdkRunner, SdkTool,
};
use serde::Serialize;
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
    let runner = state.get_runner().await.ok();
    tokio::task::spawn_blocking(move || {
        let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
        let manager = AvdManager::new(&sdk);
        let mut avds = manager.list_avds().map_err(|e| e.to_string())?;
        if let Some(runner) = runner {
            let scanner = bh_device::AdbScanner::new(runner.as_ref());
            if let Ok(devices) = scanner.list() {
                for d in devices
                    .iter()
                    .filter(|d| d.is_emulator && d.state == DeviceState::Online)
                {
                    if let Some(name) = emu_avd_name(&runner, &d.serial) {
                        if let Some(avd) =
                            avds.iter_mut().find(|a| a.name.eq_ignore_ascii_case(&name))
                        {
                            avd.running = true;
                            avd.serial = Some(d.serial.clone());
                        }
                    }
                }
            }
        }
        Ok(avds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resolve_serial_for_avd(
    state: State<'_, AppState>,
    name: String,
) -> Result<String, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wait_booted(state: State<'_, AppState>, serial: String) -> Result<(), String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        let poll_runner = runner.clone();
        let poll_serial = serial.clone();
        let booted = tokio::task::spawn_blocking(move || {
            bh_device::AdbDevice::new(poll_runner.as_ref(), &poll_serial)
                .boot_completed()
                .unwrap_or(false)
        })
        .await
        .map_err(|e| e.to_string())?;
        if booted {
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
    tokio::task::spawn_blocking(move || {
        let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
        launch_emulator_detached(&sdk, &name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<bh_device::SystemImage>, String> {
    tokio::task::spawn_blocking(move || {
        let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
        let manager = AvdManager::new(&sdk);
        manager.list_images().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_device_profiles() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
        let manager = AvdManager::new(&sdk);
        manager.list_device_profiles().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn stream_process<F>(
    bin: &Path,
    args: &[&str],
    envs: &[(&str, String)],
    on_line: F,
) -> Result<(bool, String), String>
where
    F: Fn(&str) + Send + Sync + 'static,
{
    use tokio::io::AsyncReadExt;

    let mut child = tokio::process::Command::new(bin);
    child
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in envs {
        child.env(k, v);
    }
    let mut child = child
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
    java_home: Option<&Path>,
) -> Result<bool, String> {
    let app_out = app.clone();
    let envs: Vec<(&str, String)> = match java_home {
        Some(p) => vec![("JAVA_HOME", p.display().to_string())],
        None => vec![],
    };
    let (ok, stderr) = stream_process(bin, args, &envs, move |line: &str| {
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
    let java_home = sdk.java_home().map(|p| p.to_path_buf());
    let _ = app.emit(
        "install-log",
        format!("installing {} (this can take a while)...", pkg),
    );

    match run_sdkmanager_streaming(&app, &sdkmanager, &[&pkg], java_home.as_deref()).await {
        Ok(true) => {
            let _ = app.emit("install-log", "done".to_string());
            Ok(())
        }
        Ok(false) => {
            let _ = app.emit("install-log", "accepting sdk licenses...");
            let licenses_bin = sdkmanager.clone();
            let licenses_java = java_home.clone();
            tokio::task::spawn_blocking(move || {
                accept_licenses(&licenses_bin, licenses_java.as_deref())
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
            match run_sdkmanager_streaming(&app, &sdkmanager, &[&pkg], java_home.as_deref()).await {
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
    tokio::task::spawn_blocking(move || {
        let sdk = RealSdkRunner::discover().map_err(|e| e.to_string())?;
        create_avd_with_stdin(
            sdk.tool_path(SdkTool::AvdManager),
            sdk.java_home(),
            &name,
            &pkg,
            &profile,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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

fn snapshot_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("db-snapshots"))
}

fn existing_snapshot_path(
    app: &tauri::AppHandle,
    serial: &str,
    package: &str,
    db_name: &str,
) -> Result<std::path::PathBuf, String> {
    let root = snapshot_root(app)?;
    let dir = bh_db::snapshot_dir(&root, serial, package, db_name).map_err(|e| e.to_string())?;
    let path = dir.join(db_name);
    if !path.is_file() {
        return Err(format!(
            "no local snapshot of {db_name} yet; press Refresh to pull one first"
        ));
    }
    Ok(path)
}

#[tauri::command]
pub async fn list_app_databases(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<Vec<bh_db::DbFile>, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        bh_db::list_databases(runner.as_ref(), &serial, &package).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pull_database_snapshot(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    package: String,
    db_name: String,
) -> Result<bh_db::SnapshotInfo, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let root = snapshot_root(&app)?;
    tokio::task::spawn_blocking(move || {
        bh_db::pull_snapshot(runner.as_ref(), &serial, &package, &db_name, &root)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn database_tables(
    app: tauri::AppHandle,
    serial: String,
    package: String,
    db_name: String,
) -> Result<Vec<bh_db::TableSummary>, String> {
    let path = existing_snapshot_path(&app, &serial, &package, &db_name)?;
    tokio::task::spawn_blocking(move || -> Result<Vec<bh_db::TableSummary>, String> {
        let conn = bh_db::open_snapshot(&path).map_err(|e| e.to_string())?;
        bh_db::tables(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn database_table_rows(
    app: tauri::AppHandle,
    serial: String,
    package: String,
    db_name: String,
    table: String,
    page: i64,
    page_size: i64,
    search: Option<String>,
    order_by: Option<String>,
    order_dir: Option<String>,
) -> Result<bh_db::TablePage, String> {
    let limit = page_size.clamp(1, 500);
    let offset = page.max(0).saturating_mul(limit);
    let dir = match order_dir.as_deref() {
        None => None,
        Some("asc") => Some(bh_db::OrderDir::Asc),
        Some("desc") => Some(bh_db::OrderDir::Desc),
        Some(other) => {
            return Err(format!("invalid order_dir '{other}': expected 'asc' or 'desc'"))
        }
    };
    let path = existing_snapshot_path(&app, &serial, &package, &db_name)?;
    tokio::task::spawn_blocking(move || -> Result<bh_db::TablePage, String> {
        let conn = bh_db::open_snapshot(&path).map_err(|e| e.to_string())?;
        bh_db::table_rows(
            &conn,
            &table,
            limit,
            offset,
            search.as_deref(),
            order_by.as_deref(),
            dir,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reveal_snapshot(
    app: tauri::AppHandle,
    serial: String,
    package: String,
    db_name: String,
) -> Result<(), String> {
    let path = existing_snapshot_path(&app, &serial, &package, &db_name)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_snapshot(
    app: tauri::AppHandle,
    serial: String,
    package: String,
    db_name: String,
    dest_path: String,
) -> Result<(), String> {
    let src = existing_snapshot_path(&app, &serial, &package, &db_name)?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::copy(&src, &dest_path).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn capture_start(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    port: Option<u16>,
    body_cap: Option<usize>,
) -> Result<u16, String> {
    start_capture(&state, &app, &serial, port, body_cap).await
}

async fn start_capture(
    state: &AppState,
    app: &tauri::AppHandle,
    serial: &str,
    port: Option<u16>,
    body_cap: Option<usize>,
) -> Result<u16, String> {
    let runner = state.get_runner().await.map_err(|e| e.to_string())?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ca = bh_ca::load_or_create(&dir).map_err(|e| e.to_string())?;
    let filename = bh_ca::system_cert_filename(&ca.cert_pem).map_err(|e| e.to_string())?;

    let cert_runner = runner.clone();
    let cert_serial = serial.to_string();
    let cert_pem = ca.cert_pem.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let device = bh_device::AdbDevice::new(cert_runner.as_ref(), &cert_serial);
        let installed = device
            .is_cert_installed(&filename, &cert_pem)
            .map_err(|e| e.to_string())?;
        if !installed {
            device.root().map_err(|e| e.to_string())?;
            CertificateInstaller::install_system_cert(&device, &filename, &cert_pem)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let port = match port {
        Some(p) => p,
        None => std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map_err(|e| e.to_string())?
            .port(),
    };
    let cap = body_cap.unwrap_or(256 * 1024);
    let cfg = crate::config::load(&dir).ok();
    let metro_cfg = cfg.as_ref().map(|c| c.metro.clone()).unwrap_or_default();
    let tls_bypass_hosts = cfg
        .map(|c| c.proxy.tls_bypass_hosts)
        .unwrap_or_else(|| crate::config::ProxyConfig::default().tls_bypass_hosts);
    let metro = bh_proxy::MetroBypass {
        port: metro_cfg.port,
        enabled: !metro_cfg.capture,
    };
    let handle = bh_proxy::start_mitm(
        port,
        &ca,
        cap,
        state.current_sink(),
        metro,
        tls_bypass_hosts,
    )
    .await
    .map_err(|e| e.to_string())?;

    if let Some(existing) = state.proxy.lock().await.take() {
        existing.stop().await;
    }
    if let Some(prev) = state.metro_task.lock().await.take() {
        prev.stop().await;
    }

    let proxy_runner = runner.clone();
    let proxy_serial = serial.to_string();
    let avd = tokio::task::spawn_blocking(
        move || -> Result<Option<String>, String> {
            let device = bh_device::AdbDevice::new(proxy_runner.as_ref(), &proxy_serial);
            device
                .set_proxy(crate::metro::PROXY_HOST, port)
                .map_err(|e| e.to_string())?;
            Ok(emu_avd_name(&proxy_runner, &proxy_serial))
        },
    )
    .await
    .map_err(|e| e.to_string())??;

    let metro_task = crate::metro::spawn_metro_task(app.clone());

    *state.active_serial.lock().await = Some(serial.to_string());
    if let Some(agent) = app.try_state::<crate::state::AgentState>() {
        agent.store.set_target(Some(serial.to_string()), avd);
        agent.store.set_capture(true);
    }
    state.proxy.lock().await.replace(handle);
    *state.metro_task.lock().await = Some(metro_task);
    Ok(port)
}

#[tauri::command]
pub async fn capture_stop(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    stop_capture(&state, &app).await
}

async fn stop_capture(state: &AppState, app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(metro_task) = state.metro_task.lock().await.take() {
        metro_task.stop().await;
    }
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptureCheck {
    pub id: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Option<String>,
}

fn check(id: &str, title: &str, status: CheckStatus, detail: String, fix: Option<String>) -> CaptureCheck {
    CaptureCheck {
        id: id.to_string(),
        title: title.to_string(),
        status,
        detail,
        fix,
    }
}

#[tauri::command]
pub async fn capture_health(state: State<'_, AppState>) -> Result<Vec<CaptureCheck>, String> {
    let port = state.proxy.lock().await.as_ref().map(|h| h.port);
    let Some(port) = port else {
        return Ok(vec![check(
            "capture",
            "Capture",
            CheckStatus::Ok,
            "capture stopped".into(),
            None,
        )]);
    };

    let sink = state.current_sink();
    let sink_status = if sink.alive() {
        check("sink", "Traffic sink", CheckStatus::Ok, "traffic sink is running".into(), None)
    } else {
        check(
            "sink",
            "Traffic sink",
            CheckStatus::Fail,
            "traffic sink is not running".into(),
            Some("Restart capture".into()),
        )
    };

    let connect = tokio::net::TcpStream::connect(("127.0.0.1", port));
    let proxy_status = match tokio::time::timeout(std::time::Duration::from_millis(500), connect).await
    {
        Ok(Ok(_)) => check(
            "proxy",
            "Proxy listener",
            CheckStatus::Ok,
            format!("listening on 127.0.0.1:{port}"),
            None,
        ),
        _ => check(
            "proxy",
            "Proxy listener",
            CheckStatus::Fail,
            format!("nothing is listening on 127.0.0.1:{port}"),
            Some("Restart capture".into()),
        ),
    };

    let serial = state.active_serial.lock().await.clone();
    let device_status = device_proxy_check(&state, serial.as_deref(), port).await;

    Ok(vec![sink_status, proxy_status, device_status])
}

async fn device_proxy_check(
    state: &AppState,
    serial: Option<&str>,
    port: u16,
) -> CaptureCheck {
    let expected = format!("{}:{}", crate::metro::PROXY_HOST, port);
    let Some(serial) = serial else {
        return check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Warn,
            "active target is unknown".into(),
            Some("Restart capture".into()),
        );
    };
    let runner = match state.get_runner().await {
        Ok(r) => r,
        Err(e) => {
            return check(
                "device-proxy",
                "Device proxy",
                CheckStatus::Fail,
                e.to_string(),
                None,
            )
        }
    };
    let serial = serial.to_string();
    let read = tokio::task::spawn_blocking(move || {
        let device = bh_device::AdbDevice::new(runner.as_ref(), &serial);
        ProxyConfigurator::current_proxy(&device)
    })
    .await;
    match read {
        Ok(Ok(Some(actual))) if actual == expected => check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Ok,
            format!("device routes through {actual}"),
            None,
        ),
        Ok(Ok(Some(actual))) => check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Fail,
            format!("device proxy points to {actual}, expected {expected}"),
            Some("Restart capture".into()),
        ),
        Ok(Ok(None)) => check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Fail,
            "device has no http_proxy set".into(),
            Some("Restart capture".into()),
        ),
        Ok(Err(e)) => check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Fail,
            e.to_string(),
            Some("Restart capture".into()),
        ),
        Err(e) => check(
            "device-proxy",
            "Device proxy",
            CheckStatus::Fail,
            e.to_string(),
            None,
        ),
    }
}

#[tauri::command]
pub async fn capture_restart(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    body_cap: Option<usize>,
) -> Result<u16, String> {
    stop_capture(&state, &app).await?;
    state.restart_sink(&app);
    start_capture(&state, &app, &serial, None, body_cap).await
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

#[tauri::command]
pub async fn run_host_doctor() -> Result<Vec<bh_device::host_doctor::HostCheck>, String> {
    tokio::task::spawn_blocking(|| {
        let paths = bh_device::host_doctor::HostPaths::detect();
        Ok(bh_device::host_doctor::run_checks(&paths))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn apply_host_fix(app: tauri::AppHandle, fix: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let paths = bh_device::host_doctor::HostPaths::detect();
        let runner = bh_device::host_bootstrap::RealHostRunner;
        let cache = std::env::temp_dir().join("beholder-setup");
        let mut log = |line: &str| {
            let _ = app.emit("install-log", line.to_string());
        };
        let result = match fix.as_str() {
            "install_android_studio" => bh_device::host_bootstrap::install_studio(
                &runner,
                &paths.studio_app,
                &cache,
                &mut log,
            ),
            "init_sdk_dir" => std::fs::create_dir_all(&paths.sdk_root)
                .map_err(|e| bh_device::DeviceError::Other(e.to_string())),
            "install_cmdline_tools" => bh_device::host_bootstrap::install_cmdline_tools(
                &runner,
                &paths.sdk_root,
                &cache,
                &mut log,
            ),
            "install_sdk_packages" => {
                let java = paths.java_home();
                bh_device::host_bootstrap::install_sdk_packages(
                    &runner,
                    &paths.sdk_root,
                    java.as_deref(),
                    &mut log,
                )
            }
            "write_shell_env" => {
                let home = std::env::var("HOME").map_err(|e| e.to_string())?;
                bh_device::host_bootstrap::write_shell_env(
                    &std::path::Path::new(&home).join(".zshrc"),
                    &paths.sdk_root,
                )
            }
            other => Err(bh_device::DeviceError::Other(format!("unknown fix: {other}"))),
        };
        result.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_shell_env() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(|| {
        let paths = bh_device::host_doctor::HostPaths::detect();
        Ok(bh_device::host_bootstrap::shell_env_lines(&paths.sdk_root))
    })
    .await
    .map_err(|e| e.to_string())?
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
            &[],
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
            &[],
            |_| {},
        )
        .await
        .unwrap();
        assert!(stderr.contains("license not accepted"));
    }
}
