use bh_device::companion::{self, CompanionStatus};
use bh_device::{probe, tiers, FakeRunner, Tier, TierState};
use std::time::Duration;

const PEM: &str = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const SHA_OF_AAAA: &str = "709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c";

fn row(capture: &str, package: &str, error: &str) -> String {
    format!("Row: 0 version=0.3.0, capture={capture}, package={package}, port=8080, error={error}\n")
}

fn calls(runner: &FakeRunner) -> Vec<String> {
    runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.join(" "))
        .collect()
}

#[test]
fn desktop_mode_needs_version_0_3() {
    assert!(companion::supports_desktop("0.3.0"));
    assert!(companion::supports_desktop("1.0"));
    assert!(!companion::supports_desktop("0.2.0"));
    assert!(!companion::supports_desktop("garbage"));
}

#[test]
fn companion_is_used_only_for_a_phone_with_support_and_a_package() {
    assert!(companion::use_companion("R5CT91", Some("0.3.0"), Some("com.x.app")));
    assert!(!companion::use_companion("emulator-5554", Some("0.3.0"), Some("com.x.app")));
    assert!(!companion::use_companion("R5CT91", Some("0.2.0"), Some("com.x.app")));
    assert!(!companion::use_companion("R5CT91", None, Some("com.x.app")));
    assert!(!companion::use_companion("R5CT91", Some("0.3.0"), None));
}

#[test]
fn reads_status_including_commas_in_the_error() {
    let runner = FakeRunner::new();
    runner.enqueue_ok(&row("idle", "", "boom, with commas"));
    let status = companion::status(&runner, "R5CT91").unwrap();
    assert_eq!(
        status,
        CompanionStatus {
            version: "0.3.0".into(),
            capture: "idle".into(),
            package: "".into(),
            port: 8080,
            error: "boom, with commas".into(),
        }
    );
    assert_eq!(
        calls(&runner)[0],
        "-s R5CT91 shell content query --uri content://dev.beholder.app.control/status"
    );
}

#[test]
fn unreadable_status_includes_raw_output() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("Error while accessing provider: Permission Denial");
    let err = companion::status(&runner, "R5CT91").unwrap_err();
    assert!(err.to_string().contains("Permission Denial"), "{err}");
}

#[test]
fn asks_for_the_certificate_by_fingerprint() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("Row: 0 installed=1\n");
    assert!(companion::ca_installed(&runner, "R5CT91", PEM).unwrap());
    assert!(calls(&runner)[0].ends_with(&format!("/ca/{SHA_OF_AAAA}")));
}

#[test]
fn start_waits_until_the_companion_reports_the_capture() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("");
    runner.enqueue_ok(&row("idle", "", "an older failure"));
    runner.enqueue_ok("Starting: Intent { }");
    runner.enqueue_ok(&row("idle", "", "an older failure"));
    runner.enqueue_ok(&row("desktop", "com.x.app", ""));
    companion::start(&runner, "R5CT91", "com.x.app", 8080, 5, Duration::ZERO).unwrap();
    let calls = calls(&runner);
    assert_eq!(
        calls[0],
        "-s R5CT91 shell appops set dev.beholder.app ACTIVATE_VPN allow"
    );
    assert_eq!(
        calls[2],
        "-s R5CT91 shell am start -n dev.beholder.app/.ControlActivity -a dev.beholder.app.DESKTOP_START --es package com.x.app --ei port 8080"
    );
}

#[test]
fn start_reports_the_companion_error() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("appops denied");
    runner.enqueue_ok(&row("idle", "", ""));
    runner.enqueue_ok("Starting: Intent { }");
    runner.enqueue_ok(&row("idle", "", "com.x.app is not installed"));
    let err = companion::start(&runner, "R5CT91", "com.x.app", 8080, 5, Duration::ZERO)
        .unwrap_err();
    assert!(err.to_string().contains("com.x.app is not installed"), "{err}");
}

#[test]
fn start_times_out_with_a_consent_hint() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("");
    runner.enqueue_ok(&row("idle", "", ""));
    runner.enqueue_ok("Starting: Intent { }");
    runner.enqueue_ok(&row("idle", "", ""));
    runner.enqueue_ok(&row("idle", "", ""));
    let err = companion::start(&runner, "R5CT91", "com.x.app", 8080, 2, Duration::ZERO)
        .unwrap_err();
    assert!(err.to_string().contains("accept the VPN request"), "{err}");
}

#[test]
fn start_surfaces_an_activity_manager_error() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("");
    runner.enqueue_ok(&row("idle", "", ""));
    runner.enqueue_ok("Error: Activity class does not exist.");
    let err = companion::start(&runner, "R5CT91", "com.x.app", 8080, 2, Duration::ZERO)
        .unwrap_err();
    assert!(err.to_string().contains("Activity class does not exist"), "{err}");
}

#[test]
fn start_rejects_an_unsafe_package_before_running_anything() {
    let runner = FakeRunner::new();
    assert!(
        companion::start(&runner, "R5CT91", "x; reboot", 8080, 1, Duration::ZERO).is_err()
    );
    assert!(calls(&runner).is_empty());
}

#[test]
fn stop_sends_the_stop_action() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("Starting: Intent { }");
    companion::stop(&runner, "R5CT91").unwrap();
    assert_eq!(
        calls(&runner)[0],
        "-s R5CT91 shell am start -n dev.beholder.app/.ControlActivity -a dev.beholder.app.DESKTOP_STOP"
    );
}

#[test]
fn probe_marks_the_user_certificate_ready_through_the_companion() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("SM-S911B");
    runner.enqueue_ok("14");
    runner.enqueue_ok("34");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_fail("");
    runner.enqueue_ok("0");
    runner.enqueue_ok("    versionName=0.3.0");
    runner.enqueue_fail("");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("Row: 0 installed=1");
    let probe = probe(&runner, "R5CT91", "abc.0", PEM).unwrap();
    assert_eq!(probe.user_ca_installed, Some(true));
    let user = tiers(&probe)
        .into_iter()
        .find(|t| t.tier == Tier::UserCa)
        .unwrap();
    assert_eq!(user.state, TierState::Ready);
    assert!(user.detail.contains("on the phone"));
}
