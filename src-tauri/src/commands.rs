use crate::state::AppState;
use bh_core::{har_to_string, to_curl, HttpExchange};
use bh_device::{CertificateInstaller, DeviceScanner, ProxyConfigurator};
use tauri::{Manager, State};

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
    bh_device::ProxyConfigurator::current_proxy(&device).map_err(|e| e.to_string())
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
        bh_device::CertificateInstaller::install_system_cert(&device, &filename, &ca.cert_pem)
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
            let _ = bh_device::ProxyConfigurator::clear_proxy(&device);
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
                let _ = bh_device::CertificateInstaller::uninstall_cert(&device, &name);
            }
        }
    }
    Ok(())
}
