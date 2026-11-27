use bh_device::{CommandRunner, DeviceScanner};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "companion-sessions.json";

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

pub fn recorded(dir: &Path) -> BTreeSet<String> {
    std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store(dir: &Path, sessions: &BTreeSet<String>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(file(dir), serde_json::to_string_pretty(sessions)?)
}

pub fn record(dir: &Path, serial: &str) -> std::io::Result<()> {
    let mut sessions = recorded(dir);
    sessions.insert(serial.to_string());
    store(dir, &sessions)
}

pub fn stop(runner: &dyn CommandRunner, dir: Option<&Path>, serial: &str) -> Result<(), String> {
    bh_device::companion::stop(runner, serial).map_err(|e| {
        format!(
            "the companion on {serial} may still be capturing. Reconnect the phone and Beholder stops it, or tap Stop in its notification.\n{e}"
        )
    })?;
    if let Some(dir) = dir {
        let mut sessions = recorded(dir);
        if sessions.remove(serial) {
            store(dir, &sessions).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn sweep(
    runner: &dyn CommandRunner,
    dir: &Path,
    online: &[String],
    active: Option<&str>,
) -> u32 {
    recorded(dir)
        .into_iter()
        .filter(|serial| online.contains(serial) && Some(serial.as_str()) != active)
        .filter(|serial| stop(runner, Some(dir), serial).is_ok())
        .count() as u32
}

pub fn retry_pending(runner: &dyn CommandRunner, dir: &Path, active: Option<&str>) -> u32 {
    let pending = recorded(dir)
        .iter()
        .any(|serial| Some(serial.as_str()) != active);
    if !pending {
        return 0;
    }
    let Ok(devices) = bh_device::AdbScanner::new(runner).list() else {
        return 0;
    };
    let online: Vec<String> = devices
        .into_iter()
        .filter(|d| d.state == bh_device::DeviceState::Online)
        .map(|d| d.serial)
        .collect();
    sweep(runner, dir, &online, active)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bh_device::FakeRunner;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("beholder-companion-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_failed_stop_is_reported_and_remembered() {
        let dir = temp_dir("failed");
        record(&dir, "R5CT91").unwrap();
        let runner = FakeRunner::new();
        runner.enqueue_fail("error: device offline");
        let err = stop(&runner, Some(&dir), "R5CT91").unwrap_err();
        assert!(err.contains("device offline"), "{err}");
        assert!(err.contains("may still be capturing"), "{err}");
        assert!(recorded(&dir).contains("R5CT91"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_successful_stop_forgets_the_session() {
        let dir = temp_dir("ok");
        record(&dir, "R5CT91").unwrap();
        let runner = FakeRunner::new();
        runner.enqueue_ok("Starting: Intent { }");
        stop(&runner, Some(&dir), "R5CT91").unwrap();
        assert!(recorded(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_stop_that_failed_is_retried_once_the_phone_is_back() {
        let dir = temp_dir("retry");
        record(&dir, "R5CT91").unwrap();
        let runner = FakeRunner::new();
        runner.enqueue_ok("List of devices attached\n\n");
        assert_eq!(retry_pending(&runner, &dir, None), 0);
        runner.enqueue_ok("List of devices attached\nR5CT91 device model:SM_S911B\n");
        runner.enqueue_ok("Starting: Intent { }");
        assert_eq!(retry_pending(&runner, &dir, None), 1);
        assert!(recorded(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn nothing_pending_means_no_adb_traffic() {
        let dir = temp_dir("quiet");
        let runner = FakeRunner::new();
        assert_eq!(retry_pending(&runner, &dir, None), 0);
        record(&dir, "R5CT91").unwrap();
        assert_eq!(retry_pending(&runner, &dir, Some("R5CT91")), 0);
        assert!(runner.calls.lock().unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sweep_stops_only_leftover_sessions_on_online_phones() {
        let dir = temp_dir("sweep");
        for serial in ["ONLINE", "AWAY", "ACTIVE"] {
            record(&dir, serial).unwrap();
        }
        let runner = FakeRunner::new();
        runner.enqueue_ok("Starting: Intent { }");
        let online = ["ONLINE".to_string(), "ACTIVE".to_string(), "OTHER".to_string()];
        assert_eq!(sweep(&runner, &dir, &online, Some("ACTIVE")), 1);
        assert_eq!(runner.calls.lock().unwrap().len(), 1);
        assert_eq!(runner.calls.lock().unwrap()[0][1], "ONLINE");
        let left: Vec<String> = recorded(&dir).into_iter().collect();
        assert_eq!(left, vec!["ACTIVE".to_string(), "AWAY".to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
