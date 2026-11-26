use bh_device::{probe, tiers, DeviceProbe, FakeRunner, RootAccess, Tier, TierState};

const PEM: &str = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";

fn runner(root: &[Result<&str, &str>]) -> FakeRunner {
    let runner = FakeRunner::new();
    runner.enqueue_ok("SM-S911B\n");
    runner.enqueue_ok("14\n");
    runner.enqueue_ok("34\n");
    for response in root {
        match response {
            Ok(stdout) => runner.enqueue_ok(stdout),
            Err(stderr) => runner.enqueue_fail(stderr),
        }
    }
    runner
}

fn finish(runner: &FakeRunner, companion: &str, cert: Result<&str, &str>) {
    runner.enqueue_ok(companion);
    match cert {
        Ok(stdout) => runner.enqueue_ok(stdout),
        Err(stderr) => runner.enqueue_fail(stderr),
    }
}

fn run(runner: &FakeRunner) -> DeviceProbe {
    probe(runner, "R5CT91", "abc.0", PEM).unwrap()
}

#[test]
fn reads_identity_companion_and_missing_ca() {
    let r = runner(&[Ok("uid=2000(shell)\n"), Err("")]);
    finish(&r, "    versionName=0.3.0\n", Err("No such file"));
    let p = run(&r);
    assert_eq!(p.model, "SM-S911B");
    assert_eq!(p.android_release, "14");
    assert_eq!(p.sdk, Some(34));
    assert!(!p.is_emulator);
    assert_eq!(p.root, RootAccess::None);
    assert_eq!(p.companion_version.as_deref(), Some("0.3.0"));
    assert!(!p.system_ca_installed);
}

#[test]
fn adb_running_as_root_is_adb_root() {
    let r = runner(&[Ok("uid=0(root)\n")]);
    finish(&r, "", Ok(PEM));
    let p = run(&r);
    assert_eq!(p.root, RootAccess::AdbRoot);
    assert!(p.system_ca_installed);
    assert_eq!(p.companion_version, None);
}

#[test]
fn granted_su_is_detected_with_a_timeout() {
    let r = runner(&[
        Ok("uid=2000(shell)\n"),
        Ok("/system/bin/su\n"),
        Ok("uid=0(root)\n"),
    ]);
    finish(&r, "", Err(""));
    assert_eq!(run(&r).root, RootAccess::Su);
    assert!(r
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|c| c[3] == "timeout 10 su -c id"));
}

#[test]
fn rejected_su_is_denied() {
    let r = runner(&[
        Ok("uid=2000(shell)\n"),
        Ok("/system/bin/su\n"),
        Err("Permission denied"),
    ]);
    finish(&r, "", Err(""));
    assert_eq!(run(&r).root, RootAccess::SuDenied);
}

#[test]
fn unreachable_device_reports_raw_output() {
    let r = FakeRunner::new();
    r.enqueue_fail("error: device unauthorized");
    let err = probe(&r, "R5CT91", "abc.0", PEM).unwrap_err();
    assert!(err.to_string().contains("device unauthorized"));
}

fn state_of(root: RootAccess, ca: bool, tier: Tier) -> (TierState, String) {
    let probe = DeviceProbe {
        serial: "R5CT91".into(),
        model: "x".into(),
        android_release: "14".into(),
        sdk: Some(34),
        is_emulator: false,
        root,
        system_ca_installed: ca,
        companion_version: None,
    };
    let status = tiers(&probe).into_iter().find(|s| s.tier == tier).unwrap();
    (status.state, status.detail)
}

#[test]
fn tier_table() {
    use RootAccess::{AdbRoot, None as NoRoot, Su, SuDenied};
    let cases = [
        (NoRoot, false, TierState::Locked, TierState::Action),
        (Su, false, TierState::Action, TierState::Action),
        (AdbRoot, false, TierState::Action, TierState::Action),
        (SuDenied, false, TierState::Action, TierState::Action),
        (NoRoot, true, TierState::Ready, TierState::Ready),
    ];
    for (root, ca, full, user) in cases {
        assert_eq!(state_of(root, ca, Tier::Basic).0, TierState::Ready);
        assert_eq!(state_of(root, ca, Tier::Full).0, full, "{root:?} {ca}");
        assert_eq!(state_of(root, ca, Tier::UserCa).0, user, "{root:?} {ca}");
    }
    assert!(state_of(SuDenied, false, Tier::Full).1.contains("Magisk Superuser"));
    assert!(state_of(NoRoot, false, Tier::Full).1.contains("Needs Magisk"));
}
