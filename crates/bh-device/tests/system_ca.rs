use bh_device::{
    ensure_system_ca, remove_system_ca, sh_quote, AdbDevice, CaOutcome, CertificateInstaller,
    FakeRunner,
};

const PEM: &str = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const OTHER: &str = "-----BEGIN CERTIFICATE-----\nZZZZ\n-----END CERTIFICATE-----\n";

fn joined(runner: &FakeRunner) -> Vec<String> {
    runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.join(" "))
        .collect()
}

fn shell_commands(runner: &FakeRunner) -> Vec<String> {
    runner
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|c| c[2] == "shell")
        .map(|c| c[3].clone())
        .collect()
}

#[test]
fn sh_quote_wraps_spaces_quotes_and_globs() {
    assert_eq!(sh_quote("ls /a b"), "'ls /a b'");
    assert_eq!(sh_quote("echo 'x'"), "'echo '\\''x'\\'''");
    assert_eq!(sh_quote("chmod 644 /d/*"), "'chmod 644 /d/*'");
}

#[test]
fn su_mode_wraps_mount_commands() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("no such dir");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("1 file pushed");
    for _ in 0..6 {
        runner.enqueue_ok("");
    }
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok(PEM);
    runner.enqueue_ok("abc.0");
    runner.enqueue_ok(PEM);
    let device = AdbDevice::new(&runner, "R5CT91").with_su();
    device.install_system_cert("abc.0", PEM).unwrap();
    let shell = shell_commands(&runner);
    assert!(shell.contains(
        &"su -c 'nsenter -t 1 -m -- mount -t tmpfs tmpfs /system/etc/security/cacerts'".to_string()
    ));
    assert!(shell.contains(
        &"su -c 'cp /data/local/tmp/beholder-ca-stage/* /system/etc/security/cacerts/'"
            .to_string()
    ));
    assert!(
        !shell.iter().any(|c| c.contains("cp /data/local/tmp/beholder-ca-stage/abc.0 /system")),
        "su mode must never write into the real system partition: {shell:?}"
    );
    assert!(shell.contains(&"mkdir -p /data/local/tmp/beholder-ca-stage".to_string()));
}

#[test]
fn su_mode_fails_when_the_apex_store_misses_the_certificate() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("no such dir");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("1 file pushed");
    for _ in 0..6 {
        runner.enqueue_ok("");
    }
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok(PEM);
    runner.enqueue_ok("abc.0");
    runner.enqueue_ok(OTHER);
    let device = AdbDevice::new(&runner, "R5CT91").with_su();
    let err = device.install_system_cert("abc.0", PEM).unwrap_err();
    assert!(err.to_string().contains("apex"), "{err}");
}

#[test]
fn certificate_in_the_apex_store_counts_as_installed() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("No such file");
    runner.enqueue_ok(PEM);
    assert!(AdbDevice::new(&runner, "R5CT91")
        .is_cert_installed("abc.0", PEM)
        .unwrap());
    assert!(joined(&runner)[1].contains("/apex/com.android.conscrypt/cacerts/abc.0"));
}

#[test]
fn already_trusted_certificate_needs_no_root() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("abc.0");
    runner.enqueue_ok(PEM);
    let outcome = ensure_system_ca(&runner, "R5CT91", "abc.0", PEM).unwrap();
    assert_eq!(outcome, CaOutcome::AlreadyInstalled);
    assert_eq!(runner.calls.lock().unwrap().len(), 2);
}

#[test]
fn system_copy_without_the_apex_entry_is_not_trusted_on_a_phone() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("other.0");
    runner.enqueue_fail("No such file");
    assert!(!AdbDevice::new(&runner, "R5CT91")
        .is_cert_trusted("abc.0", PEM)
        .unwrap());
    assert!(joined(&runner)[1].contains("/apex/"));
}

#[test]
fn phone_without_root_is_skipped_without_touching_adbd() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_fail("");
    runner.enqueue_ok("0");
    let outcome = ensure_system_ca(&runner, "R5CT91", "abc.0", PEM).unwrap();
    assert_eq!(outcome, CaOutcome::Skipped);
    assert!(joined(&runner).iter().all(|c| c != "-s R5CT91 root"));
}

#[test]
fn debuggable_phone_with_plain_su_still_uses_adb_root() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_ok("/system/xbin/su");
    runner.enqueue_fail("su: invalid uid/gid '-c'");
    runner.enqueue_ok("1");
    runner.enqueue_fail("stop here");
    let err = ensure_system_ca(&runner, "R5CT91", "abc.0", PEM)
        .unwrap_err()
        .to_string();
    assert!(err.contains("adb root failed"), "{err}");
    assert_eq!(joined(&runner).last().unwrap(), "-s R5CT91 root");
}

#[test]
fn denied_su_reports_the_hint_and_raw_output() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_ok("/system/bin/su");
    runner.enqueue_fail("Permission denied");
    runner.enqueue_ok("0");
    runner.enqueue_fail("Permission denied by Magisk");
    let err = ensure_system_ca(&runner, "R5CT91", "abc.0", PEM)
        .unwrap_err()
        .to_string();
    assert!(err.contains("Magisk Superuser"), "{err}");
    assert!(err.contains("Permission denied by Magisk"), "{err}");
}

#[test]
fn emulator_without_the_certificate_still_uses_adb_root() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("No such file");
    runner.enqueue_fail("No such file");
    runner.enqueue_fail("adbd cannot run as root in production builds");
    let err = ensure_system_ca(&runner, "emulator-5554", "abc.0", PEM)
        .unwrap_err()
        .to_string();
    assert!(err.contains("adb root failed"), "{err}");
    assert_eq!(joined(&runner)[2], "-s emulator-5554 root");
}

fn staged_with_su(runner: &FakeRunner) {
    runner.enqueue_ok("/data/local/tmp/beholder-ca-stage/abc.0");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_ok("/system/bin/su");
    runner.enqueue_ok("uid=0(root)");
    for _ in 0..3 {
        runner.enqueue_ok("");
    }
}

#[test]
fn phone_cleanup_leaves_certificates_beholder_did_not_stage() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("ls: abc.0: No such file or directory");
    remove_system_ca(&runner, "R5CT91", "abc.0").unwrap();
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
}

#[test]
fn phone_cleanup_reports_an_unreachable_device() {
    let runner = FakeRunner::new();
    runner.enqueue_fail("error: device offline");
    let err = remove_system_ca(&runner, "R5CT91", "abc.0").unwrap_err();
    assert!(err.to_string().contains("device offline"), "{err}");
}

#[test]
fn phone_cleanup_uses_su_and_drops_the_stage_once_gone() {
    let runner = FakeRunner::new();
    staged_with_su(&runner);
    runner.enqueue_fail("No such file");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("");
    remove_system_ca(&runner, "R5CT91", "abc.0").unwrap();
    let shell = shell_commands(&runner);
    assert!(shell.iter().any(|c| c.starts_with("su -c ") && c.contains("umount")));
    assert!(shell.last().unwrap().contains("rm -rf /data/local/tmp/beholder-ca-stage"));
}

#[test]
fn phone_cleanup_fails_and_keeps_the_stage_when_the_certificate_remains() {
    let runner = FakeRunner::new();
    staged_with_su(&runner);
    runner.enqueue_ok("/system/etc/security/cacerts/abc.0");
    let err = remove_system_ca(&runner, "R5CT91", "abc.0").unwrap_err();
    assert!(err.to_string().contains("still present"), "{err}");
    assert!(shell_commands(&runner).iter().all(|c| !c.contains("rm -rf")));
}

#[test]
fn phone_cleanup_roots_adbd_before_removing() {
    let runner = FakeRunner::new();
    runner.enqueue_ok("/data/local/tmp/beholder-ca-stage/abc.0");
    runner.enqueue_ok("uid=2000(shell)");
    runner.enqueue_fail("");
    runner.enqueue_ok("1");
    runner.enqueue_ok("restarting adbd as root");
    runner.enqueue_ok("");
    for _ in 0..3 {
        runner.enqueue_ok("");
    }
    runner.enqueue_fail("No such file");
    runner.enqueue_fail("No such file");
    runner.enqueue_ok("");
    remove_system_ca(&runner, "R5CT91", "abc.0").unwrap();
    assert_eq!(joined(&runner)[4], "-s R5CT91 root");
}
