use bh_device::{AdbDevice, CertificateInstaller, ProxyConfigurator};

#[test]
fn boot_completed_parses_getprop() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok("1\n");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    assert!(dev.boot_completed().unwrap());

    let runner2 = bh_device::FakeRunner::new();
    runner2.enqueue_ok("\n");
    let dev2 = AdbDevice::new(&runner2, "emulator-5554");
    assert!(!dev2.boot_completed().unwrap());
}

#[test]
fn set_proxy_uses_10_0_2_2() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok("");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    dev.set_proxy("10.0.2.2", 8080).unwrap();
    let calls = runner.calls.lock().unwrap();
    assert_eq!(
        calls[0],
        vec![
            "-s".to_string(),
            "emulator-5554".to_string(),
            "shell".to_string(),
            "settings put global http_proxy 10.0.2.2:8080".to_string()
        ]
    );
}

#[test]
fn current_proxy_none_for_null() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok("null\n");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    assert!(dev.current_proxy().unwrap().is_none());
}

#[test]
fn cert_install_pushes_to_system_store() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    dev.install_system_cert("abcd1234.0", "PEMDATA").unwrap();
    let calls = runner.calls.lock().unwrap();
    assert!(calls[0].contains(&"push".to_string()));
    assert!(calls[0]
        .last()
        .unwrap()
        .ends_with("/system/etc/security/cacerts/abcd1234.0"));
}
