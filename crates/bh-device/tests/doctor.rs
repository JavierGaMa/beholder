use bh_device::{apply_basic_fix, run_checks, CheckStatus, FixId};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

struct ScriptedRunner {
    outputs: Mutex<VecDeque<bh_device::Output>>,
}

impl ScriptedRunner {
    fn push(&self, stdout: &str, success: bool) {
        self.outputs.lock().unwrap().push_back(bh_device::Output {
            stdout: stdout.into(),
            stderr: String::new(),
            success,
        });
    }
}

impl bh_device::CommandRunner for ScriptedRunner {
    fn run(&self, _args: &[&str]) -> Result<bh_device::Output, bh_device::DeviceError> {
        Ok(self
            .outputs
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(bh_device::Output {
                stdout: String::new(),
                stderr: String::new(),
                success: false,
            }))
    }
}

#[test]
fn detects_dead_proxy_and_offers_fix() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=0(root)\n", true);
    runner.push("userdebug\n", true);
    runner.push("1\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("10.0.2.2:59999\n", true);
    runner.push("off\n", true);

    let always_dead = |_: u16| false;
    let checks = run_checks(runner.as_ref(), "emulator-5554", None, &always_dead, None);
    let proxy = checks.iter().find(|c| c.id == "proxy").unwrap();
    assert_eq!(proxy.status, CheckStatus::Fail);
    assert!(proxy.detail.contains("dead port"));
    assert_eq!(proxy.fix, Some(FixId::ClearProxy));
}

#[test]
fn healthy_emulator_all_ok() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=0(root)\n", true);
    runner.push("userdebug\n", true);
    runner.push("1\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("null\n", true);
    runner.push("off\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(
        runner.as_ref(),
        "emulator-5554",
        Some(true),
        &always_alive,
        None,
    );
    assert!(
        checks.iter().all(|c| c.status == CheckStatus::Ok),
        "{:?}",
        checks
    );
    assert_eq!(checks.len(), 9);
}

#[test]
fn own_active_proxy_is_ok() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=0(root)\n", true);
    runner.push("userdebug\n", true);
    runner.push("1\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("10.0.2.2:43127\n", true);
    runner.push("off\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(
        runner.as_ref(),
        "emulator-5554",
        None,
        &always_alive,
        Some(43127),
    );
    let proxy = checks.iter().find(|c| c.id == "proxy").unwrap();
    assert_eq!(proxy.status, CheckStatus::Ok);
    assert!(proxy.detail.contains("Beholder proxy active"));
}

#[test]
fn dns_warn_with_ip_ok() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=2000(shell)\n", true);
    runner.push("userdebug\n", true);
    runner.push("1\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", false);
    runner.push("", true);
    runner.push("null\n", true);
    runner.push("hostname\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(runner.as_ref(), "emulator-5554", None, &always_alive, None);
    let dns = checks.iter().find(|c| c.id == "internet_dns").unwrap();
    assert_eq!(dns.status, CheckStatus::Warn);
    let pdns = checks.iter().find(|c| c.id == "private_dns").unwrap();
    assert_eq!(pdns.fix, Some(FixId::ClearPrivateDns));
}

#[test]
fn user_build_fails_root_check() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=2000(shell)\n", true);
    runner.push("user\n", true);
    runner.push("0\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("null\n", true);
    runner.push("off\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(runner.as_ref(), "emulator-5554", None, &always_alive, None);
    let root = checks.iter().find(|c| c.id == "root").unwrap();
    assert_eq!(root.status, CheckStatus::Fail);
    assert!(root.detail.contains("refuses root"));
}

#[test]
fn shell_user_on_debuggable_image_is_ok() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
    runner.push("1\n", true);
    runner.push("uid=2000(shell)\n", true);
    runner.push("userdebug\n", true);
    runner.push("1\n", true);
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("null\n", true);
    runner.push("off\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(runner.as_ref(), "emulator-5554", None, &always_alive, None);
    let root = checks.iter().find(|c| c.id == "root").unwrap();
    assert_eq!(root.status, CheckStatus::Ok);
    assert!(root.detail.contains("will root on capture"));
}

#[test]
fn clear_proxy_fix_neutralizes_legacy_and_deletes_granular_keys() {
    let runner = bh_device::FakeRunner::new();
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    runner.enqueue_ok("");
    apply_basic_fix(&runner, "emulator-5554", FixId::ClearProxy).unwrap();
    let calls = runner.calls.lock().unwrap();
    let joined: Vec<String> = calls.iter().map(|c| c.join(" ")).collect();
    assert_eq!(
        joined[0],
        "-s emulator-5554 shell settings put global http_proxy :0"
    );
    assert!(joined.contains(&"-s emulator-5554 shell settings delete global global_http_proxy_host".to_string()));
    assert!(joined.contains(&"-s emulator-5554 shell settings delete global global_http_proxy_port".to_string()));
    assert!(joined.contains(&"-s emulator-5554 shell settings delete global global_http_proxy_exclusion_list".to_string()));
}

fn phone_runner(root_lines: &[&str], tail: &[(&str, bool)]) -> ScriptedRunner {
    let runner = ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    };
    runner.push("1\n", true);
    for line in root_lines {
        runner.push(line, !line.is_empty());
    }
    for (stdout, success) in tail {
        runner.push(stdout, *success);
    }
    runner
}

#[test]
fn phone_without_root_warns_and_skips_the_emulator_host_ping() {
    let runner = phone_runner(
        &["uid=2000(shell)\n", ""],
        &[("0\n", true), ("", true), ("", true), ("null\n", true), ("off\n", true)],
    );
    let checks = run_checks(&runner, "R5CT91", None, &|_| true, None);
    let root = checks.iter().find(|c| c.id == "root").unwrap();
    assert_eq!(root.status, CheckStatus::Warn);
    assert!(root.detail.contains("user certificates"));
    assert!(checks.iter().all(|c| c.id != "host"));
    let tunnel = checks.iter().find(|c| c.id == "tunnel").unwrap();
    assert_eq!(tunnel.status, CheckStatus::Ok);
    assert!(tunnel.detail.contains("created when capture starts"));
    assert!(checks.iter().all(|c| !c.detail.contains("Emulator")), "{checks:?}");
}

#[test]
fn phone_with_su_passes_the_root_check() {
    let runner = phone_runner(&["uid=2000(shell)\n", "/system/bin/su\n"], &[]);
    let checks = run_checks(&runner, "R5CT91", None, &|_| true, None);
    let root = checks.iter().find(|c| c.id == "root").unwrap();
    assert_eq!(root.status, CheckStatus::Ok);
    assert!(root.detail.contains("su"));
}

#[test]
fn phone_with_missing_tunnel_fails_while_capturing() {
    let runner = phone_runner(
        &["uid=2000(shell)\n", ""],
        &[
            ("0\n", true),
            ("", true),
            ("", true),
            ("", true),
            ("127.0.0.1:43127\n", true),
            ("off\n", true),
        ],
    );
    let checks = run_checks(&runner, "R5CT91", None, &|_| true, Some(43127));
    let tunnel = checks.iter().find(|c| c.id == "tunnel").unwrap();
    assert_eq!(tunnel.status, CheckStatus::Fail);
}

#[test]
fn phone_dead_loopback_proxy_offers_fix() {
    let runner = phone_runner(
        &["uid=2000(shell)\n", ""],
        &[("0\n", true), ("", true), ("", true), ("127.0.0.1:59999\n", true), ("off\n", true)],
    );
    let checks = run_checks(&runner, "R5CT91", None, &|_| false, None);
    let proxy = checks.iter().find(|c| c.id == "proxy").unwrap();
    assert_eq!(proxy.status, CheckStatus::Fail);
    assert_eq!(proxy.fix, Some(FixId::ClearProxy));
    assert!(proxy.detail.contains("dead port"));
}
