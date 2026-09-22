use crate::types::{DbError, DbFile, SnapshotInfo};
use bh_device::{AdbDevice, CommandRunner, DeviceError, Output};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const ROOT_HINT: &str =
    "reading app databases requires adb root; use a rooted emulator image (Google APIs)";

fn to_db_error(e: DeviceError) -> DbError {
    match e {
        DeviceError::AdbNotFound(m) => DbError::AdbNotFound(m),
        DeviceError::CommandFailed {
            program,
            args,
            stderr,
        } => DbError::CommandFailed {
            program,
            args,
            stderr,
        },
        DeviceError::Other(m) => DbError::Other(m),
    }
}

fn is_valid_component(value: &str, allow_hyphen: bool) -> bool {
    !value.is_empty()
        && value.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_') || (allow_hyphen && c == '-')
        })
}

fn ensure_component(kind: &str, value: &str, allow_hyphen: bool) -> Result<(), DbError> {
    if is_valid_component(value, allow_hyphen) {
        Ok(())
    } else {
        Err(DbError::Other(format!("invalid {kind}: {value}")))
    }
}

fn parse_ls_line(line: &str) -> Option<(String, u64)> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let perms = *tokens.first()?;
    if !perms.starts_with('-') {
        return None;
    }
    let time_idx = tokens.iter().position(|t| t.contains(':'))?;
    if time_idx < 3 || tokens.len() <= time_idx + 1 {
        return None;
    }
    let size = tokens[1..time_idx]
        .iter()
        .rev()
        .find(|t| t.parse::<u64>().is_ok())?
        .parse::<u64>()
        .ok()?;
    let name = tokens[time_idx + 1..].join(" ");
    if name.is_empty() {
        return None;
    }
    Some((name, size))
}

fn group_databases(entries: Vec<(String, u64)>) -> Vec<DbFile> {
    let mut files: BTreeMap<String, DbFile> = BTreeMap::new();
    let mut wal_bases: Vec<String> = Vec::new();
    for (name, size) in entries {
        if let Some(base) = name.strip_suffix("-wal") {
            wal_bases.push(base.to_string());
        } else if name.ends_with("-shm") {
            continue;
        } else {
            files.insert(
                name.clone(),
                DbFile {
                    name,
                    size_bytes: size,
                    has_wal: false,
                },
            );
        }
    }
    for base in wal_bases {
        if let Some(file) = files.get_mut(&base) {
            file.has_wal = true;
        }
    }
    files.into_values().collect()
}

pub fn list_databases(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
) -> Result<Vec<DbFile>, DbError> {
    ensure_component("serial", serial, true)?;
    ensure_component("package name", package, false)?;
    let dirs = [
        format!("/data/data/{package}/databases"),
        format!("/data/user/0/{package}/databases"),
    ];
    let mut merged: BTreeMap<String, DbFile> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();
    let mut missing_dir = false;
    for dir in &dirs {
        let out = runner
            .run(&["-s", serial, "shell", &format!("ls -l {dir}")])
            .map_err(to_db_error)?;
        let combined = format!("{}{}", out.stdout, out.stderr);
        if combined.contains("No such file or directory") {
            missing_dir = true;
            continue;
        }
        if !out.success || combined.to_lowercase().contains("permission denied") {
            failures.push(format!("adb shell ls -l {dir}: {}", combined.trim()));
            continue;
        }
        for file in group_databases(out.stdout.lines().filter_map(parse_ls_line).collect()) {
            match merged.get_mut(&file.name) {
                Some(existing) => existing.has_wal |= file.has_wal,
                None => {
                    merged.insert(file.name.clone(), file);
                }
            }
        }
    }
    if merged.is_empty() && !failures.is_empty() {
        return Err(DbError::Other(format!(
            "cannot list databases of {package}:\n{}\n{ROOT_HINT}",
            failures.join("\n")
        )));
    }
    if merged.is_empty() && missing_dir && failures.is_empty() {
        return Ok(Vec::new());
    }
    Ok(merged.into_values().collect())
}

pub fn snapshot_dir(
    dest_root: &Path,
    serial: &str,
    package: &str,
    db_name: &str,
) -> Result<PathBuf, DbError> {
    ensure_component("serial", serial, true)?;
    ensure_component("package name", package, false)?;
    ensure_component("database name", db_name, true)?;
    Ok(dest_root.join(serial).join(package).join(db_name))
}

fn pull_file(
    runner: &dyn CommandRunner,
    serial: &str,
    remote: &str,
    local_dir: &Path,
) -> Result<Output, DbError> {
    let file_name = remote.rsplit('/').next().unwrap_or(remote);
    let local = local_dir.join(file_name);
    runner
        .run(&["-s", serial, "pull", remote, &local.to_string_lossy()])
        .map_err(to_db_error)
}

pub fn pull_snapshot(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    db_name: &str,
    dest_root: &Path,
) -> Result<SnapshotInfo, DbError> {
    let dir = snapshot_dir(dest_root, serial, package, db_name)?;
    let remote_base = format!("/data/data/{package}/databases/{db_name}");
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| DbError::Other(format!("clear stale snapshot {}: {e}", dir.display())))?;
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| DbError::Other(format!("create snapshot dir {}: {e}", dir.display())))?;

    let mut out = pull_file(runner, serial, &remote_base, &dir)?;
    if !out.success {
        let combined = format!("{}{}", out.stdout, out.stderr).to_lowercase();
        if combined.contains("does not exist") || combined.contains("no such file") {
            return Err(DbError::NotFound(format!(
                "database {db_name} not found on device: {}{}",
                out.stdout.trim(),
                out.stderr.trim()
            )));
        }
        AdbDevice::new(runner, serial).root().map_err(to_db_error)?;
        out = pull_file(runner, serial, &remote_base, &dir)?;
        if !out.success {
            return Err(DbError::CommandFailed {
                program: "adb pull".into(),
                args: vec![remote_base],
                stderr: format!("{}{}", out.stdout, out.stderr),
            });
        }
    }

    for suffix in ["-wal", "-shm"] {
        let _ = pull_file(runner, serial, &format!("{remote_base}{suffix}"), &dir);
    }

    let mut size_bytes = 0u64;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| DbError::Other(format!("read snapshot dir {}: {e}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| DbError::Other(e.to_string()))?;
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                size_bytes += meta.len();
            }
        }
    }

    let pulled_at_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let local_path = dir.join(db_name);
    Ok(SnapshotInfo {
        local_path: local_path.to_string_lossy().to_string(),
        size_bytes,
        pulled_at_epoch_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bh_device::FakeRunner;

    const LS_OUTPUT: &str = "total 8\n-rw-rw---- 1 u0_a1 u0_a1 4096 2024-01-02 03:04 app.db\n-rw-rw---- 1 u0_a1 u0_a1 2048 2024-01-02 03:04 app.db-wal\n-rw-rw---- 1 u0_a1 u0_a1 32 2024-01-02 03:04 app.db-shm\ndrwxrwxr-x 2 u0_a1 u0_a1 4096 2024-01-02 03:04 .\nlrwxrwxrwx 1 root root 12 2024-01-02 03:04 link.db\n-rw-rw---- 1 u0_a1 u0_a1 8192 2024-01-02 03:04 other.db\n";

    #[test]
    fn parses_regular_files_groups_wal_and_skips_junk() {
        let runner = FakeRunner::new();
        runner.enqueue_ok(LS_OUTPUT);
        runner.enqueue_ok(LS_OUTPUT);
        let files = list_databases(&runner, "emu", "com.x").unwrap();
        assert_eq!(
            files,
            vec![
                DbFile {
                    name: "app.db".into(),
                    size_bytes: 4096,
                    has_wal: true
                },
                DbFile {
                    name: "other.db".into(),
                    size_bytes: 8192,
                    has_wal: false
                },
            ]
        );
        let calls = runner.calls.lock().unwrap();
        assert_eq!(
            calls[0],
            vec!["-s", "emu", "shell", "ls -l /data/data/com.x/databases"]
        );
        assert_eq!(
            calls[1],
            vec!["-s", "emu", "shell", "ls -l /data/user/0/com.x/databases"]
        );
    }

    #[test]
    fn parses_toolbox_and_numeric_owner_formats() {
        assert_eq!(
            parse_ls_line("-rw-rw---- root root 40960 2016-03-01 12:00 legacy.db"),
            Some(("legacy.db".into(), 40960))
        );
        assert_eq!(
            parse_ls_line("-rw-rw---- 1 10055 10055 8192 2024-01-02 03:04 uid.db"),
            Some(("uid.db".into(), 8192))
        );
        assert_eq!(
            parse_ls_line("-rw-rw---- 1 u0_a1 u0_a1 7 2024-01-02 03:04 my db name.db"),
            Some(("my db name.db".into(), 7))
        );
        assert_eq!(parse_ls_line("total 8"), None);
        assert_eq!(
            parse_ls_line("drwxrwxr-x 2 u0 u0 4096 2024-01-02 03:04 ."),
            None
        );
        assert_eq!(
            parse_ls_line("lrwxrwxrwx 1 root root 12 2024-01-02 03:04 link.db"),
            None
        );
        assert_eq!(parse_ls_line("garbage"), None);
        assert_eq!(parse_ls_line(""), None);
    }

    #[test]
    fn wal_without_base_is_ignored() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("-rw-rw---- 1 u0 u0 10 2024-01-02 03:04 lone.db-wal\n");
        runner.enqueue_ok("-rw-rw---- 1 u0 u0 10 2024-01-02 03:04 lone.db-wal\n");
        assert!(list_databases(&runner, "emu", "com.x").unwrap().is_empty());
    }

    #[test]
    fn merges_and_dedupes_both_paths() {
        let runner = FakeRunner::new();
        runner.enqueue_ok(
            "-rw-rw---- 1 u0 u0 4096 2024-01-02 03:04 app.db\n-rw-rw---- 1 u0 u0 10 2024-01-02 03:04 app.db-wal\n",
        );
        runner.enqueue_ok(
            "-rw-rw---- 1 u0 u0 4096 2024-01-02 03:05 app.db\n-rw-rw---- 1 u0 u0 100 2024-01-02 03:05 extra.db\n",
        );
        let files = list_databases(&runner, "emu", "com.x").unwrap();
        assert_eq!(
            files,
            vec![
                DbFile {
                    name: "app.db".into(),
                    size_bytes: 4096,
                    has_wal: true
                },
                DbFile {
                    name: "extra.db".into(),
                    size_bytes: 100,
                    has_wal: false
                },
            ]
        );
    }

    #[test]
    fn uses_second_path_when_first_is_denied() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("ls: /data/data/com.x/databases: Permission denied");
        runner.enqueue_ok("-rw-rw---- 1 u0 u0 4096 2024-01-02 03:04 app.db\n");
        let files = list_databases(&runner, "emu", "com.x").unwrap();
        assert_eq!(
            files,
            vec![DbFile {
                name: "app.db".into(),
                size_bytes: 4096,
                has_wal: false
            }]
        );
    }

    #[test]
    fn permission_denied_everywhere_includes_raw_output_and_hint() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("ls: /data/data/com.x/databases: Permission denied");
        runner.enqueue_fail("ls: /data/user/0/com.x/databases: Permission denied");
        let err = list_databases(&runner, "emu", "com.x").unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Permission denied"),
            "raw output missing: {msg}"
        );
        assert!(msg.contains("Google APIs"), "root hint missing: {msg}");
    }

    #[test]
    fn missing_databases_dir_returns_empty() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("ls: /data/data/com.x/databases: No such file or directory");
        runner.enqueue_fail("ls: /data/user/0/com.x/databases: No such file or directory");
        assert!(list_databases(&runner, "emu", "com.x").unwrap().is_empty());
    }

    #[test]
    fn rejects_unsafe_package_and_serial() {
        let runner = FakeRunner::new();
        let err = list_databases(&runner, "emu", "com.x; rm -rf /").unwrap_err();
        assert!(err.to_string().contains("invalid package"));
        let err = list_databases(&runner, "emu && cat", "com.x").unwrap_err();
        assert!(err.to_string().contains("invalid serial"));
        assert!(runner.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn pull_uses_deterministic_dir_and_attempts_wal_shm() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        let dest = std::env::temp_dir().join(format!("bh-db-pull-{}", std::process::id()));
        let dir = dest.join("emu").join("com.x").join("app.db");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("app.db"), b"stale").unwrap();
        std::fs::write(dir.join("app.db-wal"), b"stale-wal").unwrap();

        let info = pull_snapshot(&runner, "emu", "com.x", "app.db", &dest).unwrap();

        assert_eq!(
            info.local_path,
            dir.join("app.db").to_string_lossy().to_string()
        );
        assert!(!dir.join("app.db-wal").exists());
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert_eq!(
            calls[0],
            vec![
                "-s",
                "emu",
                "pull",
                "/data/data/com.x/databases/app.db",
                &dir.join("app.db").to_string_lossy().to_string()
            ]
        );
        assert_eq!(
            calls[1],
            vec![
                "-s",
                "emu",
                "pull",
                "/data/data/com.x/databases/app.db-wal",
                &dir.join("app.db-wal").to_string_lossy().to_string()
            ]
        );
        assert_eq!(
            calls[2],
            vec![
                "-s",
                "emu",
                "pull",
                "/data/data/com.x/databases/app.db-shm",
                &dir.join("app.db-shm").to_string_lossy().to_string()
            ]
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn pull_failure_roots_once_and_retries() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(
            "adb: error: failed to stat remote object '/data/data/com.x/databases/app.db': Permission denied",
        );
        runner.enqueue_ok("restarting adbd as root");
        runner.enqueue_ok("");
        runner.enqueue_ok("app.db: 1 file pulled");
        runner.enqueue_fail("no wal");
        runner.enqueue_fail("no shm");

        let info = pull_snapshot(
            &runner,
            "emu",
            "com.x",
            "app.db",
            std::path::Path::new("/tmp/bh-db-root-test"),
        )
        .unwrap();
        assert!(info.local_path.ends_with("app.db"));

        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls[1], vec!["-s", "emu", "root"]);
        assert_eq!(calls[2], vec!["-s", "emu", "wait-for-device"]);
        assert_eq!(calls[3], calls[0]);
        assert_eq!(calls.len(), 6);
    }

    #[test]
    fn pull_retry_failure_carries_raw_output() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(
            "adb: error: failed to stat remote object '/data/data/com.x/databases/app.db': Permission denied",
        );
        runner.enqueue_ok("restarting adbd as root");
        runner.enqueue_ok("");
        runner.enqueue_fail(
            "adb: error: failed to stat remote object '/data/data/com.x/databases/app.db': Permission denied",
        );
        let err = pull_snapshot(
            &runner,
            "emu",
            "com.x",
            "app.db",
            std::path::Path::new("/tmp/bh-db-retry-test"),
        )
        .unwrap_err();
        match err {
            DbError::CommandFailed {
                program,
                args,
                stderr,
            } => {
                assert_eq!(program, "adb pull");
                assert_eq!(args, vec!["/data/data/com.x/databases/app.db"]);
                assert!(stderr.contains("Permission denied"));
            }
            other => panic!("expected CommandFailed, got {other}"),
        }
    }

    #[test]
    fn pull_missing_db_returns_not_found_without_rooting() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(
            "adb: error: failed to stat remote object '/data/data/com.x/databases/missing.db': No such file or directory",
        );
        let err = pull_snapshot(
            &runner,
            "emu",
            "com.x",
            "missing.db",
            std::path::Path::new("/tmp/bh-db-missing-test"),
        )
        .unwrap_err();
        assert!(matches!(err, DbError::NotFound(m) if m.contains("missing.db")));
        assert_eq!(runner.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn pull_rejects_path_traversal_db_name() {
        let runner = FakeRunner::new();
        let err = pull_snapshot(
            &runner,
            "emu",
            "com.x",
            "../evil",
            std::path::Path::new("/tmp/bh-db-evil-test"),
        )
        .unwrap_err();
        assert!(err.to_string().contains("invalid database name"));
        assert!(runner.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn snapshot_dir_rejects_slashes_in_serial() {
        let err = snapshot_dir(Path::new("/tmp"), "e/mu", "com.x", "app.db").unwrap_err();
        assert!(err.to_string().contains("invalid serial"));
    }
}
