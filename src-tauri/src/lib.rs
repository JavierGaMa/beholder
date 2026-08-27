mod batch;
mod commands;
mod state;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sink = Arc::new(batch::BatchSink::spawn(app.handle().clone()));
            app.manage(state::AppState::new(sink));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::adb_status,
            commands::list_devices,
            commands::current_proxy,
            commands::list_avds,
            commands::launch_avd,
            commands::resolve_serial_for_avd,
            commands::wait_booted,
            commands::list_images,
            commands::list_device_profiles,
            commands::install_image,
            commands::create_avd,
            commands::run_doctor,
            commands::apply_doctor_fix,
            commands::clear_stale_proxies,
            commands::capture_start,
            commands::capture_stop,
            commands::full_cleanup,
            commands::format_curl,
            commands::export_har,
            commands::export_postman,
            commands::export_bruno_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(async {
                let state = app_handle.state::<state::AppState>();
                let serial = state.active_serial.lock().await.clone();
                if let Some(serial) = serial {
                    if let Ok(runner) = bh_device::RealRunner::discover() {
                        let device = bh_device::AdbDevice::new(&runner, &serial);
                        let _ = bh_device::ProxyConfigurator::clear_proxy(&device);
                    }
                }
            });
        }
    });
}
