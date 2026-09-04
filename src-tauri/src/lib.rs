mod batch;
mod commands;
mod config;
mod console;
mod state;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let agent_cfg = app
                .path()
                .app_local_data_dir()
                .ok()
                .and_then(|dir| config::load(&dir).ok())
                .map(|c| c.agent)
                .unwrap_or_default();
            let agent_store = Arc::new(bh_agent::AgentStore::new(bh_agent::AgentLimits {
                ring_requests: agent_cfg.ring_requests,
                console_lines: agent_cfg.console_lines,
                max_body_chars: agent_cfg.max_body_chars,
            }));
            if agent_cfg.enabled {
                let store = agent_store.clone();
                let bind = agent_cfg.bind.clone();
                tauri::async_runtime::spawn(async move {
                    let token = bh_agent::generate_token();
                    if let Err(e) = bh_agent::serve(store, &bind, &token).await {
                        eprintln!("agent api failed: {e}");
                    }
                });
            }
            let sink =
                Arc::new(batch::BatchSink::spawn(app.handle().clone(), Some(agent_store.clone())));
            app.manage(state::AppState::new(sink));
            let console_sink = Arc::new(console::ConsoleBatchSink::spawn(
                app.handle().clone(),
                Some(agent_store.clone()),
            ));
            app.manage(state::ConsoleState::new(console_sink));
            app.manage(state::AgentState { store: agent_store });

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(dir) = handle.path().app_local_data_dir() {
                    spawn_config_watcher(handle.clone(), dir);
                }
            });
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
            commands::export_bruno_folder,
            commands::get_config,
            commands::set_config,
            commands::reveal_config,
            commands::console_start,
            commands::console_stop,
            commands::console_set_filter,
            commands::console_apps,
            commands::console_clear_buffer,
            commands::console_export,
            commands::console_shell_start,
            commands::console_shell_stop,
            commands::console_shell_input,
            commands::console_shell_resize,
            commands::agent_pin_request,
            commands::agent_unpin_request,
            commands::agent_pin_log,
            commands::agent_clear_pins,
            commands::agent_set_focus_app
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
                if let Some(console) = app_handle.try_state::<state::ConsoleState>() {
                    if let Some(handle) = console.session.lock().await.take() {
                        handle.stop();
                    }
                    if let Some(slot) = console.shell.lock().await.take() {
                        slot.handle.kill();
                    }
                }
            });
        }
    });
}

fn spawn_config_watcher(app: tauri::AppHandle, dir: std::path::PathBuf) {
    use notify::Watcher;
    use tauri::Emitter;

    let (tx, rx) = std::sync::mpsc::channel();
    let Ok(mut watcher) = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(event) = res {
            if event.kind.is_modify() || event.kind.is_create() {
                let _ = tx.send(());
            }
        }
    }) else {
        return;
    };
    if watcher
        .watch(&dir, notify::RecursiveMode::NonRecursive)
        .is_err()
    {
        return;
    }
    drop(watcher);

    loop {
        if rx.recv().is_err() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        while rx.try_recv().is_ok() {}
        if let Ok(config) = config::load(&dir) {
            let _ = app.emit("config-changed", &config);
        }
    }
}
