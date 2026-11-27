use bh_device::{AdbDevice, FakeRunner};

#[test]
fn reverse_maps_the_same_port_on_both_sides() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("8080");
    AdbDevice::new(&runner, "R5CT91").reverse(8080).unwrap();
    assert_eq!(
        runner.calls.lock().unwrap()[0],
        vec!["-s", "R5CT91", "reverse", "tcp:8080", "tcp:8080"]
    );
}

#[test]
fn reverse_failure_includes_raw_output() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("adb: error: device offline");
    let err = AdbDevice::new(&runner, "R5CT91").reverse(8080).unwrap_err();
    assert!(err.to_string().contains("adb: error: device offline"));
}

#[test]
fn remove_reverse_removes_only_the_given_port() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("");
    AdbDevice::new(&runner, "R5CT91").remove_reverse(8080).unwrap();
    assert_eq!(
        runner.calls.lock().unwrap()[0],
        vec!["-s", "R5CT91", "reverse", "--remove", "tcp:8080"]
    );
}

#[test]
fn has_reverse_reads_the_listing() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("host-22 tcp:8081 tcp:8081\nhost-22 tcp:8080 tcp:8080\n");
    runner.enqueue_ok("host-22 tcp:80800 tcp:80800\n");
    let device = AdbDevice::new(&runner, "R5CT91");
    assert!(device.has_reverse(8080).unwrap());
    assert!(!device.has_reverse(8080).unwrap());
    assert_eq!(
        runner.calls.lock().unwrap()[0],
        vec!["-s", "R5CT91", "reverse", "--list"]
    );
}

#[test]
fn has_reverse_failure_includes_raw_output() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("error: closed");
    let err = AdbDevice::new(&runner, "R5CT91").has_reverse(8080).unwrap_err();
    assert!(err.to_string().contains("error: closed"));
}
