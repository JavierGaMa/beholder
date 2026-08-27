use crate::runner::{CommandRunner, DeviceError, Output};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FixId {
    ClearProxy,
    DisableAirplane,
    ClearPrivateDns,
    Reboot,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DoctorCheck {
    pub id: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Option<FixId>,
}

fn sh(runner: &dyn CommandRunner, serial: &str, cmd: &str) -> Output {
    runner.run(&["-s", serial, "shell", cmd]).unwrap_or(Output {
        stdout: String::new(),
        stderr: String::new(),
        success: false,
    })
}

fn getprop(runner: &dyn CommandRunner, serial: &str, prop: &str) -> String {
    sh(runner, serial, &format!("getprop {prop}"))
        .stdout
        .trim()
        .to_string()
}

pub fn parse_proxy_value(raw: &str) -> Option<(String, u16)> {
    let v = raw.trim();
    if v.is_empty() || v == "null" || v == ":0" {
        return None;
    }
    let (host, port) = v.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    Some((host.to_string(), port))
}

pub fn run_checks(
    runner: &dyn CommandRunner,
    serial: &str,
    ca_installed: Option<bool>,
    port_alive: &dyn Fn(u16) -> bool,
    active_proxy_port: Option<u16>,
) -> Vec<DoctorCheck> {
    let mut checks = Vec::new();

    let boot = getprop(runner, serial, "sys.boot_completed");
    checks.push(DoctorCheck {
        id: "boot".into(),
        title: "Boot completed".into(),
        status: if boot == "1" {
            CheckStatus::Ok
        } else {
            CheckStatus::Fail
        },
        detail: if boot == "1" {
            "Android is fully booted".into()
        } else {
            "Emulator is still booting — wait and re-run".into()
        },
        fix: None,
    });

    let airplane_raw = sh(runner, serial, "settings get global airplane_mode_on")
        .stdout
        .trim()
        .to_string();
    checks.push(DoctorCheck {
        id: "airplane".into(),
        title: "Radio on".into(),
        status: if airplane_raw == "1" {
            CheckStatus::Fail
        } else {
            CheckStatus::Ok
        },
        detail: if airplane_raw == "1" {
            "Airplane mode is ON — no connectivity until disabled".into()
        } else {
            "Airplane mode off".into()
        },
        fix: if airplane_raw == "1" {
            Some(FixId::DisableAirplane)
        } else {
            None
        },
    });

    let ip_ok = sh(runner, serial, "ping -c 1 -W 3 8.8.8.8").success;
    checks.push(DoctorCheck {
        id: "internet_ip".into(),
        title: "Internet (raw IP)".into(),
        status: if ip_ok {
            CheckStatus::Ok
        } else {
            CheckStatus::Fail
        },
        detail: if ip_ok {
            "Emulator reaches 8.8.8.8".into()
        } else {
            "No raw IP connectivity — check your Mac's network or the AVD network settings".into()
        },
        fix: None,
    });

    let dns_ok = sh(runner, serial, "ping -c 1 -W 3 google.com").success;
    checks.push(DoctorCheck {
        id: "internet_dns".into(),
        title: "DNS resolution".into(),
        status: if dns_ok {
            CheckStatus::Ok
        } else if ip_ok {
            CheckStatus::Warn
        } else {
            CheckStatus::Fail
        },
        detail: if dns_ok {
            "DNS resolves google.com".into()
        } else if ip_ok {
            "IP works but DNS fails — often private DNS or a stale proxy".into()
        } else {
            "Cannot test DNS without IP connectivity".into()
        },
        fix: None,
    });

    let host_ok = sh(runner, serial, "ping -c 1 -W 2 10.0.2.2").success;
    checks.push(DoctorCheck {
        id: "host".into(),
        title: "Host reachable (10.0.2.2)".into(),
        status: if host_ok {
            CheckStatus::Ok
        } else {
            CheckStatus::Fail
        },
        detail: if host_ok {
            "Emulator reaches your Mac — Beholder proxy endpoint is reachable".into()
        } else {
            "Emulator cannot reach your Mac (10.0.2.2)".into()
        },
        fix: None,
    });

    let proxy_raw = sh(runner, serial, "settings get global http_proxy")
        .stdout
        .trim()
        .to_string();
    let parsed = parse_proxy_value(&proxy_raw);
    let (status, detail, fix) = match (&parsed, active_proxy_port) {
        (None, _) => (CheckStatus::Ok, "No proxy set".to_string(), None),
        (Some((host, port)), Some(own)) if *port == own => (
            CheckStatus::Ok,
            format!("Beholder proxy active ({}:{})", host, port),
            None,
        ),
        (Some((host, port)), _) => {
            if host == "10.0.2.2" && !port_alive(*port) {
                (
                    CheckStatus::Fail,
                    format!(
                        "Proxy {}:{} points to a dead port on your Mac — this kills all emulator internet. Likely a leftover session.",
                        host, port
                    ),
                    Some(FixId::ClearProxy),
                )
            } else {
                (
                    CheckStatus::Warn,
                    format!(
                        "Proxy {}:{} set by another tool — Beholder cannot capture through it",
                        host, port
                    ),
                    Some(FixId::ClearProxy),
                )
            }
        }
    };
    checks.push(DoctorCheck {
        id: "proxy".into(),
        title: "HTTP proxy".into(),
        status,
        detail,
        fix,
    });

    let private_dns = sh(runner, serial, "settings get global private_dns_mode")
        .stdout
        .trim()
        .to_string();
    let pdns_off = private_dns == "off" || private_dns == "null" || private_dns.is_empty();
    checks.push(DoctorCheck {
        id: "private_dns".into(),
        title: "Private DNS".into(),
        status: if pdns_off {
            CheckStatus::Ok
        } else {
            CheckStatus::Warn
        },
        detail: if pdns_off {
            "Off".into()
        } else {
            format!("Private DNS is '{private_dns}' — encrypted DNS can hide traffic from Beholder")
        },
        fix: if pdns_off {
            None
        } else {
            Some(FixId::ClearPrivateDns)
        },
    });

    if let Some(installed) = ca_installed {
        checks.push(DoctorCheck {
            id: "ca".into(),
            title: "Beholder CA".into(),
            status: if installed { CheckStatus::Ok } else { CheckStatus::Warn },
            detail: if installed {
                "CA trusted by the system store".into()
            } else {
                "CA not installed — HTTPS bodies won't be visible (reinstalled on next capture start)".into()
            },
            fix: None,
        });
    }

    checks
}

pub fn apply_basic_fix(
    runner: &dyn CommandRunner,
    serial: &str,
    fix: FixId,
) -> Result<(), DeviceError> {
    let cmd = match fix {
        FixId::ClearProxy => "settings put global http_proxy :0",
        FixId::DisableAirplane => "cmd connectivity airplane-mode disable",
        FixId::ClearPrivateDns => "settings put global private_dns_mode off",
        FixId::Reboot => "reboot",
    };
    let out = runner.run(&["-s", serial, "shell", cmd])?;
    if !out.success {
        if fix == FixId::DisableAirplane {
            runner.run(&[
                "-s",
                serial,
                "shell",
                "settings put global airplane_mode_on 0",
            ])?;
            runner.run(&[
                "-s",
                serial,
                "shell",
                "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false",
            ])?;
            return Ok(());
        }
        return Err(DeviceError::Other(format!(
            "fix {:?} failed: {}",
            fix,
            out.stderr.trim()
        )));
    }
    Ok(())
}
