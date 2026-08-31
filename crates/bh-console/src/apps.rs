use crate::types::ConsoleError;
use bh_device::{CommandRunner, DeviceError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppProcess {
    pub package: String,
    pub pid: Option<u32>,
}

fn to_console_error(e: DeviceError) -> ConsoleError {
    match e {
        DeviceError::AdbNotFound(m) => ConsoleError::AdbNotFound(m),
        DeviceError::CommandFailed {
            program,
            args,
            stderr,
        } => ConsoleError::CommandFailed {
            program,
            args,
            stderr,
        },
        DeviceError::Other(m) => ConsoleError::Other(m),
    }
}

fn parse_packages(stdout: &str) -> Vec<String> {
    let mut packages: Vec<String> = stdout
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:"))
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    packages.sort();
    packages.dedup();
    packages
}

fn parse_pid(stdout: &str) -> Option<u32> {
    stdout
        .trim()
        .split_whitespace()
        .next()
        .and_then(|first| first.parse::<u32>().ok())
}

fn pidof(runner: &dyn CommandRunner, serial: &str, package: &str) -> Result<Option<u32>, ConsoleError> {
    let out = runner
        .run(&["-s", serial, "shell", &format!("pidof {package}")])
        .map_err(to_console_error)?;
    if !out.success {
        return Ok(None);
    }
    Ok(parse_pid(&out.stdout))
}

pub fn list_apps(runner: &dyn CommandRunner, serial: &str) -> Result<Vec<AppProcess>, ConsoleError> {
    let out = runner
        .run(&["-s", serial, "shell", "pm list packages -3"])
        .map_err(to_console_error)?;
    if !out.success {
        return Err(ConsoleError::CommandFailed {
            program: "adb".into(),
            args: vec![format!("-s {serial} shell pm list packages -3")],
            stderr: out.stderr,
        });
    }
    let packages = parse_packages(&out.stdout);
    let mut apps = Vec::with_capacity(packages.len());
    for package in packages {
        let pid = pidof(runner, serial, &package)?;
        apps.push(AppProcess { package, pid });
    }
    Ok(apps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bh_device::FakeRunner;

    #[test]
    fn lists_apps_with_pids_sorted_by_package() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.zeta\npackage:com.alpha\npackage:com.mid\n");
        runner.enqueue_ok("1001\n");
        runner.enqueue_ok("");
        runner.enqueue_ok("2002 2003\n");
        let apps = list_apps(&runner, "emulator-5554").unwrap();
        assert_eq!(
            apps,
            vec![
                AppProcess {
                    package: "com.alpha".into(),
                    pid: Some(1001)
                },
                AppProcess {
                    package: "com.mid".into(),
                    pid: None
                },
                AppProcess {
                    package: "com.zeta".into(),
                    pid: Some(2002)
                },
            ]
        );
        let calls = runner.calls.lock().unwrap();
        assert_eq!(
            calls[0],
            vec!["-s", "emulator-5554", "shell", "pm list packages -3"]
        );
        assert_eq!(calls[1], vec!["-s", "emulator-5554", "shell", "pidof com.alpha"]);
        assert_eq!(calls[2], vec!["-s", "emulator-5554", "shell", "pidof com.mid"]);
        assert_eq!(calls[3], vec!["-s", "emulator-5554", "shell", "pidof com.zeta"]);
    }

    #[test]
    fn empty_pidof_output_yields_none() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.foo\n");
        runner.enqueue_ok("\n \n");
        let apps = list_apps(&runner, "emu").unwrap();
        assert_eq!(apps, vec![AppProcess { package: "com.foo".into(), pid: None }]);
    }

    #[test]
    fn failed_pidof_yields_none() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.foo\n");
        runner.enqueue_fail("");
        let apps = list_apps(&runner, "emu").unwrap();
        assert_eq!(apps, vec![AppProcess { package: "com.foo".into(), pid: None }]);
    }

    #[test]
    fn pidof_whitespace_parses_first_integer() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.foo\n");
        runner.enqueue_ok("  3001  3002\n");
        let apps = list_apps(&runner, "emu").unwrap();
        assert_eq!(
            apps,
            vec![AppProcess {
                package: "com.foo".into(),
                pid: Some(3001)
            }]
        );
    }

    #[test]
    fn pidof_non_integer_output_yields_none() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.foo\n");
        runner.enqueue_ok("not-a-pid\n");
        let apps = list_apps(&runner, "emu").unwrap();
        assert_eq!(apps, vec![AppProcess { package: "com.foo".into(), pid: None }]);
    }

    #[test]
    fn skips_lines_without_package_prefix() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("package:com.ok\n\ngarbage line\npackage:com.ok\n");
        runner.enqueue_ok("42\n");
        let apps = list_apps(&runner, "emu").unwrap();
        assert_eq!(
            apps,
            vec![AppProcess {
                package: "com.ok".into(),
                pid: Some(42)
            }]
        );
    }

    #[test]
    fn empty_package_list_returns_empty_vec() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        let apps = list_apps(&runner, "emu").unwrap();
        assert!(apps.is_empty());
    }

    #[test]
    fn pm_failure_returns_command_failed_with_stderr() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("device offline");
        let err = list_apps(&runner, "emu").unwrap_err();
        match err {
            ConsoleError::CommandFailed { stderr, .. } => assert_eq!(stderr, "device offline"),
            other => panic!("expected CommandFailed, got {other}"),
        }
    }

    #[test]
    fn adb_not_found_maps_to_console_error() {
        let runner = FakeRunner::new();
        runner
            .responses
            .lock()
            .unwrap()
            .push_back(Err(DeviceError::AdbNotFound("no adb".into())));
        let err = list_apps(&runner, "emu").unwrap_err();
        assert!(matches!(err, ConsoleError::AdbNotFound(m) if m == "no adb"));
    }

    #[test]
    fn app_process_serializes_snake_case() {
        let v = serde_json::to_value(AppProcess {
            package: "com.foo".into(),
            pid: Some(7),
        })
        .unwrap();
        assert_eq!(v["package"], "com.foo");
        assert_eq!(v["pid"], 7);
        let v = serde_json::to_value(AppProcess {
            package: "com.bar".into(),
            pid: None,
        })
        .unwrap();
        assert_eq!(v["pid"], serde_json::Value::Null);
    }
}
