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
fn cert_install_direct_push_when_system_writable() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_fail("no such dir");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    dev.install_system_cert("abcd1234.0", "PEMDATA").unwrap();
    let calls = runner.calls.lock().unwrap();
    let joined: Vec<String> = calls.iter().map(|c| c.join(" ")).collect();
    let push_call = joined.iter().find(|c| c.contains(" push ")).unwrap();
    assert!(push_call.ends_with("/data/local/tmp/beholder-ca-stage/abcd1234.0"));
    assert!(joined.iter().any(|c| c.contains(
        "cp /data/local/tmp/beholder-ca-stage/abcd1234.0 /system/etc/security/cacerts/abcd1234.0"
    )));
    assert!(!joined.iter().any(|c| c.contains("nsenter")));
}

#[test]
fn cert_install_falls_back_to_tmpfs_when_readonly() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_fail("no such dir");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_fail("Read-only file system");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("1");
    runner.enqueue_fail("");
    runner.enqueue_fail("");
    runner.enqueue_ok("abcd1234.0");
    let dev = AdbDevice::new(&runner, "emulator-5554");
    dev.install_system_cert("abcd1234.0", "PEMDATA").unwrap();
    let calls = runner.calls.lock().unwrap();
    let joined: Vec<String> = calls.iter().map(|c| c.join(" ")).collect();
    assert!(joined
        .iter()
        .any(|c| c.contains("nsenter -t 1 -m -- mount -t tmpfs")));
    assert!(joined.iter().any(
        |c| c.contains("cp /data/local/tmp/beholder-ca-stage/* /system/etc/security/cacerts/")
    ));
    assert!(joined
        .iter()
        .any(|c| c.contains("chmod 644 /system/etc/security/cacerts/*")));
}
