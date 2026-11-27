use bh_device::{AdbDevice, FakeRunner};

#[test]
fn push_user_ca_copies_the_certificate_to_downloads() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("1 file pushed");
    AdbDevice::new(&runner, "R5CT91").push_user_ca("PEM").unwrap();
    let calls = runner.calls.lock().unwrap();
    assert_eq!(calls[0][2], "push");
    assert_eq!(calls[0][4], "/sdcard/Download/beholder-ca.crt");
}

#[test]
fn push_user_ca_failure_includes_raw_output() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("remote couldn't create file");
    let err = AdbDevice::new(&runner, "R5CT91")
        .push_user_ca("PEM")
        .unwrap_err();
    assert!(err.to_string().contains("remote couldn't create file"));
}

#[test]
fn opens_the_security_settings_screen() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("Starting: Intent");
    AdbDevice::new(&runner, "R5CT91")
        .open_security_settings()
        .unwrap();
    assert_eq!(
        runner.calls.lock().unwrap()[0][3],
        "am start -a android.settings.SECURITY_SETTINGS"
    );
}
