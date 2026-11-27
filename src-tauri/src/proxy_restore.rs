use bh_device::{CommandRunner, ProxyConfigurator};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "proxy-restore.json";

type Saved = BTreeMap<String, Option<String>>;

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

fn load(dir: &Path) -> Saved {
    std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store(dir: &Path, saved: &Saved) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(file(dir), serde_json::to_string_pretty(saved)?)
}

pub fn is_beholder_proxy(value: &str) -> bool {
    value.rsplit_once(':').is_some_and(|(host, _)| {
        host == crate::metro::PROXY_HOST || host == crate::metro::DEVICE_PROXY_HOST
    })
}

pub fn previous_to_save(current: Option<&str>, saved: Option<Option<String>>) -> Option<String> {
    match current {
        Some(value) if is_beholder_proxy(value) => saved.flatten(),
        other => other.map(str::to_string),
    }
}

pub fn lookup(dir: &Path, serial: &str) -> Option<Option<String>> {
    load(dir).remove(serial)
}

pub fn remember(dir: &Path, serial: &str, previous: Option<String>) -> std::io::Result<()> {
    let mut saved = load(dir);
    saved.insert(serial.to_string(), previous);
    store(dir, &saved)
}

pub fn forget(dir: &Path, serial: &str) -> std::io::Result<()> {
    let mut saved = load(dir);
    if saved.remove(serial).is_none() {
        return Ok(());
    }
    store(dir, &saved)
}

pub fn release_device(
    runner: &dyn CommandRunner,
    dir: Option<&Path>,
    serial: &str,
    port: Option<u16>,
) {
    let device = bh_device::AdbDevice::new(runner, serial);
    let saved = dir.and_then(|dir| lookup(dir, serial));
    let owned = saved.is_some() || dir.is_none() || bh_device::is_emulator_serial(serial);
    if owned && device.restore_proxy(saved.flatten().as_deref()).is_ok() {
        if let Some(dir) = dir {
            let _ = forget(dir, serial);
        }
    }
    if let Some(port) = port.filter(|_| !bh_device::is_emulator_serial(serial)) {
        let _ = device.remove_reverse(port);
    }
}

pub fn is_stale(
    serial: &str,
    proxy: &str,
    active_port: Option<u16>,
    port_alive: &dyn Fn(u16) -> bool,
    saved: bool,
) -> bool {
    let Some(port) = proxy.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else {
        return false;
    };
    let ours = bh_device::is_emulator_serial(serial) || (saved && is_beholder_proxy(proxy));
    ours && Some(port) != active_port && !port_alive(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("beholder-restore-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn recognises_proxies_written_by_beholder() {
        assert!(is_beholder_proxy("10.0.2.2:8080"));
        assert!(is_beholder_proxy("127.0.0.1:8080"));
        assert!(!is_beholder_proxy("proxy.corp.example:3128"));
        assert!(!is_beholder_proxy("10.0.2.20:8080"));
    }

    #[test]
    fn remembers_and_forgets_the_previous_value_per_device() {
        let dir = temp_dir("round-trip");
        remember(&dir, "A", Some("corp:3128".into())).unwrap();
        remember(&dir, "B", None).unwrap();
        assert_eq!(lookup(&dir, "A"), Some(Some("corp:3128".into())));
        assert_eq!(lookup(&dir, "B"), Some(None));
        assert_eq!(lookup(&dir, "C"), None);
        forget(&dir, "A").unwrap();
        assert_eq!(lookup(&dir, "A"), None);
        assert_eq!(lookup(&dir, "B"), Some(None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_leftover_beholder_proxy_keeps_the_saved_value() {
        let dir = temp_dir("leftover");
        remember(&dir, "A", previous_to_save(Some("corp:3128"), None)).unwrap();
        let again = previous_to_save(Some("127.0.0.1:9000"), lookup(&dir, "A"));
        assert_eq!(again, Some("corp:3128".into()));
        assert_eq!(previous_to_save(Some("127.0.0.1:9000"), None), None);
        assert_eq!(previous_to_save(None, Some(Some("old:1".into()))), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn release_restores_then_forgets_and_removes_the_tunnel() {
        let dir = temp_dir("release");
        remember(&dir, "R5CT91", Some("corp:3128".into())).unwrap();
        let runner = bh_device::FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        release_device(&runner, Some(&dir), "R5CT91", Some(8080));
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls[0][3], "settings put global http_proxy corp:3128");
        assert_eq!(calls[1], vec!["-s", "R5CT91", "reverse", "--remove", "tcp:8080"]);
        assert_eq!(lookup(&dir, "R5CT91"), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn release_keeps_the_saved_value_when_the_device_is_unreachable() {
        let dir = temp_dir("unreachable");
        remember(&dir, "R5CT91", Some("corp:3128".into())).unwrap();
        let runner = bh_device::FakeRunner::new();
        runner.enqueue_fail("error: device not found");
        release_device(&runner, Some(&dir), "R5CT91", None);
        assert_eq!(lookup(&dir, "R5CT91"), Some(Some("corp:3128".into())));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn releasing_a_phone_twice_never_clears_the_restored_proxy() {
        let dir = temp_dir("twice");
        remember(&dir, "R5CT91", Some("corp:3128".into())).unwrap();
        let runner = bh_device::FakeRunner::new();
        runner.enqueue_ok("");
        release_device(&runner, Some(&dir), "R5CT91", None);
        release_device(&runner, Some(&dir), "R5CT91", None);
        assert_eq!(runner.calls.lock().unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn releasing_an_emulator_without_a_saved_value_still_clears() {
        let dir = temp_dir("emulator-clear");
        let runner = bh_device::FakeRunner::new();
        for _ in 0..4 {
            runner.enqueue_ok("");
        }
        release_device(&runner, Some(&dir), "emulator-5554", None);
        assert_eq!(runner.calls.lock().unwrap().len(), 4);
    }

    #[test]
    fn stale_rules_differ_for_emulators_and_phones() {
        let dead = |_: u16| false;
        let alive = |_: u16| true;
        assert!(is_stale("emulator-5554", "corp:3128", None, &dead, false));
        assert!(!is_stale("emulator-5554", "10.0.2.2:8080", None, &alive, false));
        assert!(!is_stale("emulator-5554", "10.0.2.2:8080", Some(8080), &dead, false));
        assert!(is_stale("R5CT91", "127.0.0.1:8080", None, &dead, true));
        assert!(!is_stale("R5CT91", "127.0.0.1:8080", None, &dead, false));
        assert!(!is_stale("R5CT91", "corp:3128", None, &dead, true));
        assert!(!is_stale("R5CT91", "127.0.0.1:8080", None, &alive, true));
    }
}
