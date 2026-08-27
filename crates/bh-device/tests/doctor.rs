use bh_device::{run_checks, CheckStatus, FixId};
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
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", true);
    runner.push("", true);
    runner.push(":0\n", true);
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
    assert_eq!(checks.len(), 8);
}

#[test]
fn own_active_proxy_is_ok() {
    let runner = Arc::new(ScriptedRunner {
        outputs: Mutex::new(VecDeque::new()),
    });
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
    runner.push("0\n", true);
    runner.push("", true);
    runner.push("", false);
    runner.push("", true);
    runner.push(":0\n", true);
    runner.push("hostname\n", true);

    let always_alive = |_: u16| true;
    let checks = run_checks(runner.as_ref(), "emulator-5554", None, &always_alive, None);
    let dns = checks.iter().find(|c| c.id == "internet_dns").unwrap();
    assert_eq!(dns.status, CheckStatus::Warn);
    let pdns = checks.iter().find(|c| c.id == "private_dns").unwrap();
    assert_eq!(pdns.fix, Some(FixId::ClearPrivateDns));
}
