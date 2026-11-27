use bh_device::{DeviceScanner, DeviceState};

#[test]
fn parses_adb_devices_output() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok(
        "List of devices attached\nemulator-5554\tdevice\n0123456789ABCDEF\tunauthorized\n\n",
    );
    let scanner = bh_device::AdbScanner::new(&runner);
    let devices = scanner.list().unwrap();
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].serial, "emulator-5554");
    assert!(devices[0].is_emulator);
    assert_eq!(devices[0].state, DeviceState::Online);
    assert_eq!(devices[1].serial, "0123456789ABCDEF");
    assert!(!devices[1].is_emulator);
    assert_eq!(devices[1].state, DeviceState::Unauthorized);
}

#[test]
fn reads_model_from_long_listing() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok(
        "List of devices attached\nR5CT91                 device usb:1-1 product:dm1q model:SM_S911B device:dm1q transport_id:3\nABC                    unauthorized usb:1-2 transport_id:4\n",
    );
    let scanner = bh_device::AdbScanner::new(&runner);
    let devices = scanner.list().unwrap();
    assert_eq!(devices[0].model.as_deref(), Some("SM S911B"));
    assert_eq!(devices[1].model, None);
    assert_eq!(devices[1].state, DeviceState::Unauthorized);
    assert_eq!(runner.calls.lock().unwrap()[0], vec!["devices", "-l"]);
}

#[test]
fn emulator_serials_are_recognised_by_prefix() {
    assert!(bh_device::is_emulator_serial("emulator-5554"));
    assert!(!bh_device::is_emulator_serial("192.168.1.20:5555"));
    assert!(!bh_device::is_emulator_serial("R5CT91"));
}
