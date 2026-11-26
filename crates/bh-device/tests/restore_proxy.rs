use bh_device::{AdbDevice, FakeRunner, ProxyConfigurator};

#[test]
fn restore_proxy_writes_the_previous_value_back() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("");
    AdbDevice::new(&runner, "R5CT91")
        .restore_proxy(Some("proxy.corp.example:3128"))
        .unwrap();
    assert_eq!(
        runner.calls.lock().unwrap()[0],
        vec![
            "-s",
            "R5CT91",
            "shell",
            "settings put global http_proxy proxy.corp.example:3128"
        ]
    );
}

#[test]
fn restore_proxy_without_previous_value_clears() {
    let runner = FakeRunner::new();
    for _ in 0..4 {
        runner.enqueue_ok("");
    }
    AdbDevice::new(&runner, "R5CT91").restore_proxy(None).unwrap();
    let calls = runner.calls.lock().unwrap();
    assert_eq!(calls[0][3], "settings put global http_proxy :0");
    assert_eq!(calls.len(), 4);
}

#[test]
fn restore_proxy_never_sends_shell_metacharacters() {
    let runner = FakeRunner::new();
    for _ in 0..4 {
        runner.enqueue_ok("");
    }
    AdbDevice::new(&runner, "R5CT91")
        .restore_proxy(Some("host:1; rm -rf /sdcard"))
        .unwrap();
    assert!(runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .all(|call| !call[3].contains("rm -rf")));
}
