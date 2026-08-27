use crate::state::AppState;
use bh_core::{har_to_string, to_curl, HttpExchange};
use bh_device::{
    accept_licenses, create_avd_with_stdin, launch_emulator_detached, AvdManager,
    CertificateInstaller, CommandRunner, DeviceScanner, DeviceState, ProxyConfigurator,
    RealSdkRunner, SdkTool,
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
                if let Ok(out) = runner.run(&["-s", &d.serial, "emu", "avd", "name"]) {
                    if let Some(name) = out
                        .stdout
                        .lines()
                        .map(str::trim)
                        .find(|l| !l.is_empty() && *l != "OK")
                    {
                        if let Some(avd) =
                            avds.iter_mut().find(|a| a.name.eq_ignore_ascii_case(name))
                        {
                            avd.running = true;
                        }
                    }
                }
            }
        }
    }
    Ok(avds)
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

async fn run_sdkmanager_streaming(
    app: &tauri::AppHandle,
    bin: &Path,
    args: &[&str],
) -> Result<bool, String> {
    let mut child = tokio::process::Command::new(bin)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut stdout = child.stdout.take().ok_or("no stdout".to_string())?;
    let mut stderr = child.stderr.take().ok_or("no stderr".to_string())?;
    let app_out = app.clone();

    let emit_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = [0u8; 4096];
        let mut line = String::new();
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for &b in &buf[..n] {
                        if b == b'\r' || b == b'\n' {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                let _ = app_out.emit("install-log", trimmed.to_string());
                            }
                            line.clear();
                        } else {
                            line.push(b as char);
                        }
                    }
                }
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut err = String::new();
        let _ = stderr.read_to_string(&mut err).await;
        err
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = emit_task.await;
    let stderr = stderr_task.await.unwrap_or_default();

    if status.success() {
        Ok(true)
    } else if stderr.to_lowercase().contains("license") {
        Ok(false)
    } else {
        Err(if stderr.trim().is_empty() {
            format!("sdkmanager exited with {status}")
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
        .is_cert_installed(&filename)
        .map_err(|e| e.to_string())?;
    if !installed {
        device.root().map_err(|e| e.to_string())?;
        device.remount().map_err(|e| e.to_string())?;
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
    *state.active_serial.lock().await = Some(serial);
    state.proxy.lock().await.replace(handle);
    Ok(port)
}

#[tauri::command]
pub async fn capture_stop(state: State<'_, AppState>) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
pub fn format_curl(exchange: HttpExchange) -> Result<String, String> {
    Ok(to_curl(&exchange))
}

#[tauri::command]
pub fn export_har(exchanges: Vec<HttpExchange>) -> Result<String, String> {
    Ok(har_to_string(&exchanges))
}

#[tauri::command]
pub async fn full_cleanup(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    capture_stop(state.clone()).await?;
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
