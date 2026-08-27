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
