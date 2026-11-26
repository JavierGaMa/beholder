use crate::types::{DbError, DbFile, SnapshotInfo};
use bh_device::{
    is_emulator_serial, root_access, AdbDevice, CommandRunner, DeviceError, Output, RootAccess,
    SU_GRANT_HINT,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const ROOT_HINT: &str = "reading app databases requires adb root, su (Magisk) or a debuggable app (run-as); on emulators use a Google APIs image";
const SU_STAGING: &str = "/data/local/tmp/beholder-db";

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

fn is_valid_serial(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
}

fn ensure_serial(serial: &str) -> Result<(), DbError> {
    if is_valid_serial(serial) {
        Ok(())
    } else {
        Err(DbError::Other(format!("invalid serial: {serial}")))
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

fn parse_stat_owner(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (uid, gid) = trimmed.split_once(':')?;
    let numeric = |v: &str| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit());
    if numeric(uid) && numeric(gid) {
        Some(trimmed.to_string())
    } else {
        None
    }
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
    ensure_serial(serial)?;
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
        if !is_emulator_serial(serial) {
            match list_unprivileged(runner, serial, package) {
                Ok(files) => return Ok(files),
                Err(strategies) => failures.extend(strategies),
            }
        }
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
    ensure_serial(serial)?;
    ensure_component("package name", package, false)?;
    ensure_component("database name", db_name, true)?;
    Ok(dest_root
        .join(serial.replace(':', "_"))
        .join(package)
        .join(db_name))
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

fn pull_as_root(
    runner: &dyn CommandRunner,
    serial: &str,
    remote_base: &str,
    dir: &Path,
    db_name: &str,
) -> Result<(), DbError> {
    let mut out = pull_file(runner, serial, remote_base, dir)?;
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
        out = pull_file(runner, serial, remote_base, dir)?;
        if !out.success {
            return Err(DbError::CommandFailed {
                program: "adb pull".into(),
                args: vec![remote_base.to_string()],
                stderr: format!("{}{}", out.stdout, out.stderr),
            });
        }
    }

    for suffix in ["-wal", "-shm"] {
        let _ = pull_file(runner, serial, &format!("{remote_base}{suffix}"), dir);
    }
    Ok(())
}

fn with_strategies(error: DbError, strategies: &[String]) -> DbError {
    let detail = format!("{}\n{ROOT_HINT}", strategies.join("\n"));
    match error {
        DbError::CommandFailed {
            program,
            args,
            stderr,
        } => DbError::CommandFailed {
            program,
            args,
            stderr: format!("{stderr}\n{detail}"),
        },
        other => DbError::Other(format!("{other}\n{detail}")),
    }
}

fn has_su(runner: &dyn CommandRunner, serial: &str, failures: &mut Vec<String>) -> bool {
    match root_access(runner, serial) {
        Ok(RootAccess::Su) => true,
        Ok(RootAccess::SuDenied) => {
            failures.push(format!("su: {SU_GRANT_HINT}"));
            false
        }
        Ok(_) => false,
        Err(e) => {
            failures.push(format!("su: {e}"));
            false
        }
    }
}

fn listed(out: Result<Output, DeviceError>, strategy: &str) -> Result<Vec<DbFile>, String> {
    let out = out.map_err(|e| format!("{strategy}: {e}"))?;
    let combined = format!("{}{}", out.stdout, out.stderr);
    if combined.contains("No such file or directory") {
        return Ok(Vec::new());
    }
    if !out.success || combined.to_lowercase().contains("permission denied") {
        return Err(format!("{strategy}: {}", combined.trim()));
    }
    Ok(group_databases(
        out.stdout.lines().filter_map(parse_ls_line).collect(),
    ))
}

fn list_unprivileged(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
) -> Result<Vec<DbFile>, Vec<String>> {
    let device = AdbDevice::new(runner, serial);
    let mut failures = Vec::new();
    if has_su(runner, serial, &mut failures) {
        let out = AdbDevice::new(runner, serial)
            .with_su()
            .exec(&format!("ls -l /data/data/{package}/databases"));
        match listed(out, "su") {
            Ok(files) => return Ok(files),
            Err(e) => failures.push(e),
        }
    }
    let out = device.exec(&format!("run-as {package} ls -l databases"));
    match listed(out, "run-as") {
        Ok(files) => Ok(files),
        Err(e) => {
            failures.push(e);
            Err(failures)
        }
    }
}

fn pull_unprivileged(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    db_name: &str,
    dir: &Path,
) -> Result<(), Vec<String>> {
    let mut failures = Vec::new();
    if has_su(runner, serial, &mut failures) {
        match pull_with_su(runner, serial, package, db_name, dir) {
            Ok(()) => return Ok(()),
            Err(e) => failures.push(format!("su: {e}")),
        }
    }
    match pull_with_run_as(runner, serial, package, db_name, dir) {
        Ok(()) => Ok(()),
        Err(e) => {
            failures.push(format!("run-as: {e}"));
            Err(failures)
        }
    }
}

fn pull_with_su(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    db_name: &str,
    dir: &Path,
) -> Result<(), DbError> {
    let root = AdbDevice::new(runner, serial).with_su();
    let staging = format!("{SU_STAGING}/{package}");
    let step = |cmd: String| -> Result<(), DbError> {
        let out = root.exec(&cmd).map_err(to_db_error)?;
        if out.success {
            Ok(())
        } else {
            Err(DbError::Other(format!(
                "'{cmd}' failed: {}{}",
                out.stdout.trim(),
                out.stderr.trim()
            )))
        }
    };
    let copy = |file: &str| -> Result<(), DbError> {
        step(format!(
            "cp /data/data/{package}/databases/{file} {staging}/{file} && chmod 644 {staging}/{file}"
        ))?;
        let out = pull_file(runner, serial, &format!("{staging}/{file}"), dir)?;
        if out.success {
            Ok(())
        } else {
            Err(DbError::Other(format!(
                "adb pull {staging}/{file} failed: {}{}",
                out.stdout.trim(),
                out.stderr.trim()
            )))
        }
    };
    let result = step(format!(
        "mkdir -p {staging} && chmod 755 {SU_STAGING} {staging}"
    ))
    .and_then(|()| copy(db_name))
    .map(|()| {
        for suffix in ["-wal", "-shm"] {
            let _ = copy(&format!("{db_name}{suffix}"));
        }
    });
    let _ = step(format!("rm -rf {staging}"));
    result
}

fn pull_with_run_as(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    db_name: &str,
    dir: &Path,
) -> Result<(), DbError> {
    let device = AdbDevice::new(runner, serial);
    for suffix in ["", "-wal", "-shm"] {
        let file = format!("{db_name}{suffix}");
        let remote = format!("databases/{file}");
        let stat = device
            .exec(&format!("run-as {package} stat -c %s {remote}"))
            .map_err(to_db_error)?;
        let Some(expected) = stat
            .success
            .then(|| stat.stdout.trim().parse::<u64>().ok())
            .flatten()
        else {
            if suffix.is_empty() {
                return Err(DbError::Other(format!(
                    "cannot read {remote}: {}{}",
                    stat.stdout.trim(),
                    stat.stderr.trim()
                )));
            }
            continue;
        };
        let local = dir.join(&file);
        let out = runner
            .run_to_file(
                &[
                    "-s",
                    serial,
                    "exec-out",
                    &format!("run-as {package} cat {remote}"),
                ],
                &local,
            )
            .map_err(to_db_error)?;
        let actual = std::fs::metadata(&local).map(|m| m.len()).unwrap_or(0);
        if !out.success || actual != expected {
            return Err(DbError::Other(format!(
                "copy of {remote} is incomplete: expected {expected} bytes, got {actual}. {}",
                out.stderr.trim()
            )));
        }
    }
    Ok(())
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

    if let Err(error) = pull_as_root(runner, serial, &remote_base, &dir, db_name) {
        if is_emulator_serial(serial) || matches!(error, DbError::NotFound(_)) {
            return Err(error);
        }
        pull_unprivileged(runner, serial, package, db_name, &dir)
            .map_err(|strategies| with_strategies(error, &strategies))?;
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

pub fn delete_snapshot(
    serial: &str,
    package: &str,
    db_name: &str,
    dest_root: &Path,
) -> Result<bool, DbError> {
    let dir = snapshot_dir(dest_root, serial, package, db_name)?;
    if !dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| DbError::Other(format!("delete snapshot {}: {e}", dir.display())))?;
    Ok(true)
}

fn run_shell(runner: &dyn CommandRunner, serial: &str, cmd: &str) -> Result<String, DeviceError> {
    let out = runner.run(&["-s", serial, "shell", cmd])?;
    if !out.success {
        return Err(DeviceError::Other(format!(
            "shell '{cmd}' failed: {}{}",
            out.stdout.trim(),
            out.stderr.trim()
        )));
    }
    Ok(out.stdout.trim().to_string())
}

fn run_shell_ok(runner: &dyn CommandRunner, serial: &str, cmd: &str) -> Result<(), DeviceError> {
    run_shell(runner, serial, cmd).map(|_| ())
}

pub fn apply_to_device(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    db_name: &str,
    snapshot_path: &Path,
) -> Result<(), DeviceError> {
    if !is_valid_serial(serial) {
        return Err(DeviceError::Other(format!("invalid serial: {serial}")));
    }
    if !is_valid_component(package, false) {
        return Err(DeviceError::Other(format!("invalid package name: {package}")));
    }
    if !is_valid_component(db_name, true) {
        return Err(DeviceError::Other(format!("invalid database name: {db_name}")));
    }

    run_shell_ok(runner, serial, &format!("am force-stop {package}"))?;

    let conn = crate::snapshot::open_snapshot_rw(snapshot_path)
        .map_err(|e| DeviceError::Other(format!("open snapshot for checkpoint: {e}")))?;
    crate::snapshot::checkpoint(&conn)
        .map_err(|e| DeviceError::Other(format!("checkpoint snapshot: {e}")))?;

    let local = snapshot_path.to_string_lossy().to_string();
    let remote = format!("/data/data/{package}/databases/{db_name}");
    let out = runner.run(&["-s", serial, "push", &local, &remote])?;
    if !out.success {
        return Err(DeviceError::CommandFailed {
            program: "adb push".into(),
            args: vec![local],
            stderr: format!("{}{}", out.stdout, out.stderr),
        });
    }

    let databases_dir = format!("/data/data/{package}/databases");
    let stat_cmd = format!("stat -c '%u:%g' {databases_dir}");
    let owner = run_shell(runner, serial, &stat_cmd).and_then(|raw| {
        parse_stat_owner(&raw).ok_or_else(|| {
            DeviceError::Other(format!(
                "cannot determine owner of {databases_dir}: unexpected stat output: {raw:?}"
            ))
        })
    })?;
    run_shell_ok(runner, serial, &format!("chown {owner} {remote}"))?;
    run_shell_ok(runner, serial, &format!("chmod 660 {remote}"))?;

    for suffix in ["-wal", "-shm"] {
        run_shell_ok(
            runner,
            serial,
            &format!("rm -f /data/data/{package}/databases/{db_name}{suffix}"),
        )?;
    }
    Ok(())
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

    #[test]
    fn delete_snapshot_removes_dir_with_sidecar_files() {
        let dest = std::env::temp_dir().join(format!("bh-db-delete-{}", std::process::id()));
        let dir = dest.join("emu").join("com.x").join("app.db");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("app.db"), b"data").unwrap();
        std::fs::write(dir.join("app.db-wal"), b"wal").unwrap();

        assert!(delete_snapshot("emu", "com.x", "app.db", &dest).unwrap());

        assert!(!dir.exists());
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn delete_snapshot_returns_false_when_no_dir_exists() {
        let dest =
            std::env::temp_dir().join(format!("bh-db-delete-missing-{}", std::process::id()));
        assert!(!delete_snapshot("emu", "com.x", "app.db", &dest).unwrap());
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn delete_snapshot_rejects_path_traversal_db_name() {
        let err = delete_snapshot("emu", "com.x", "../evil", Path::new("/tmp/bh-db-delete-evil"))
            .unwrap_err();
        assert!(err.to_string().contains("invalid database name"));
    }

    fn snapshot_with_wal(tag: &str) -> (std::path::PathBuf, rusqlite::Connection) {
        let dir = std::env::temp_dir().join(format!(
            "bh-db-apply-{tag}-{}-{}",
            std::process::id(),
            runner_call_count()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.db");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute("CREATE TABLE t (v TEXT)", []).unwrap();
        conn.execute("INSERT INTO t VALUES ('pending-in-wal')", [])
            .unwrap();
        (path, conn)
    }

    fn runner_call_count() -> u64 {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    #[test]
    fn apply_to_device_force_stops_checkpoints_pushes_then_cleans_up() {
        let (path, conn) = snapshot_with_wal("order");
        let wal = path
            .parent()
            .unwrap()
            .join(format!("{}-wal", path.file_name().unwrap().to_string_lossy()));
        assert!(wal.exists() && wal.metadata().unwrap().len() > 0);

        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_ok("app.db: 1 file pushed, 12 bytes/s");
        runner.enqueue_ok("10085:10085");
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        runner.enqueue_ok("");

        apply_to_device(&runner, "emu", "com.x", "app.db", &path).unwrap();

        assert!(
            !wal.exists() || wal.metadata().unwrap().len() == 0,
            "wal must be checkpointed before push"
        );
        let local = path.to_string_lossy().to_string();
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls.len(), 7);
        assert_eq!(calls[0], vec!["-s", "emu", "shell", "am force-stop com.x"]);
        assert_eq!(calls[1], vec!["-s", "emu", "push", &local, "/data/data/com.x/databases/app.db"]);
        assert_eq!(
            calls[2],
            vec![
                "-s",
                "emu",
                "shell",
                "stat -c '%u:%g' /data/data/com.x/databases"
            ]
        );
        assert_eq!(
            calls[3],
            vec![
                "-s",
                "emu",
                "shell",
                "chown 10085:10085 /data/data/com.x/databases/app.db"
            ]
        );
        assert_eq!(
            calls[4],
            vec![
                "-s",
                "emu",
                "shell",
                "chmod 660 /data/data/com.x/databases/app.db"
            ]
        );
        assert_eq!(
            calls[5],
            vec![
                "-s",
                "emu",
                "shell",
                "rm -f /data/data/com.x/databases/app.db-wal"
            ]
        );
        assert_eq!(
            calls[6],
            vec![
                "-s",
                "emu",
                "shell",
                "rm -f /data/data/com.x/databases/app.db-shm"
            ]
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn apply_to_device_unparseable_stat_owner_fails_with_raw_output() {
        let (path, conn) = snapshot_with_wal("stat-garbage");
        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_ok("app.db: 1 file pushed");
        runner.enqueue_ok("uid=1027(owner) gid=1027(owner)");

        let err = apply_to_device(&runner, "emu", "com.x", "app.db", &path).unwrap_err();
        assert!(
            matches!(err, DeviceError::Other(ref m) if m.contains("uid=1027(owner) gid=1027(owner)")
                && m.contains("/data/data/com.x/databases")),
            "unexpected error: {err}"
        );
        assert_eq!(runner.calls.lock().unwrap().len(), 3);
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn apply_to_device_chown_failure_propagates_and_skips_cleanup() {
        let (path, conn) = snapshot_with_wal("chown-fail");
        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_ok("app.db: 1 file pushed");
        runner.enqueue_ok("10085:10085");
        runner.enqueue_fail("chown: /data/data/com.x/databases/app.db: Read-only file system");

        let err = apply_to_device(&runner, "emu", "com.x", "app.db", &path).unwrap_err();
        assert!(
            matches!(err, DeviceError::Other(ref m) if m.contains("chown 10085:10085")
                && m.contains("Read-only file system")),
            "unexpected error: {err}"
        );
        assert_eq!(runner.calls.lock().unwrap().len(), 4);
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn apply_to_device_push_failure_carries_raw_output_and_skips_cleanup() {
        let (path, conn) = snapshot_with_wal("push-fail");
        let runner = FakeRunner::new();
        runner.enqueue_ok("");
        runner.enqueue_fail("adb: error: failed to push app.db: Read-only file system");

        let err = apply_to_device(&runner, "emu", "com.x", "app.db", &path).unwrap_err();
        match err {
            DeviceError::CommandFailed {
                program,
                args,
                stderr,
            } => {
                assert_eq!(program, "adb push");
                assert_eq!(args, vec![path.to_string_lossy().to_string()]);
                assert!(stderr.contains("Read-only file system"), "raw output: {stderr}");
            }
            other => panic!("expected CommandFailed, got {other:?}"),
        }
        assert_eq!(runner.calls.lock().unwrap().len(), 2);
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn apply_to_device_force_stop_failure_aborts_with_raw_output() {
        let (path, conn) = snapshot_with_wal("fs-fail");
        let runner = FakeRunner::new();
        runner.enqueue_fail("Error: java.lang.SecurityException: Permission Denial");

        let err = apply_to_device(&runner, "emu", "com.x", "app.db", &path).unwrap_err();
        assert!(
            matches!(err, DeviceError::Other(ref m) if m.contains("am force-stop com.x")
                && m.contains("Permission Denial")),
            "unexpected error: {err}"
        );
        assert_eq!(runner.calls.lock().unwrap().len(), 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn apply_to_device_rejects_unsafe_components_without_running_adb() {
        let (path, conn) = snapshot_with_wal("invalid");
        let runner = FakeRunner::new();
        let err = apply_to_device(&runner, "emu", "com.x; rm -rf /", "app.db", &path).unwrap_err();
        assert!(err.to_string().contains("invalid package"));
        let err = apply_to_device(&runner, "emu", "com.x", "../evil", &path).unwrap_err();
        assert!(err.to_string().contains("invalid database name"));
        assert!(runner.calls.lock().unwrap().is_empty());
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    const DENIED: &str = "adb: error: failed to stat remote object: Permission denied";
    const NO_ROOT: &str = "adbd cannot run as root in production builds";

    fn deny_listing(runner: &FakeRunner) {
        runner.enqueue_fail("ls: /data/data/com.x/databases: Permission denied");
        runner.enqueue_fail("ls: /data/user/0/com.x/databases: Permission denied");
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

    fn temp_dest(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bh-db-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn phone_with_su_lists_through_su() {
        let runner = FakeRunner::new();
        deny_listing(&runner);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_ok("/system/bin/su");
        runner.enqueue_ok("uid=0(root)");
        runner.enqueue_ok(LS_OUTPUT);
        let files = list_databases(&runner, "R5CT91", "com.x").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(
            shell_commands(&runner).last().unwrap(),
            "su -c 'ls -l /data/data/com.x/databases'"
        );
    }

    #[test]
    fn phone_without_root_lists_through_run_as() {
        let runner = FakeRunner::new();
        deny_listing(&runner);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_fail("");
        runner.enqueue_ok(LS_OUTPUT);
        let files = list_databases(&runner, "R5CT91", "com.x").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(
            shell_commands(&runner).last().unwrap(),
            "run-as com.x ls -l databases"
        );
    }

    #[test]
    fn phone_listing_failure_names_each_strategy() {
        let runner = FakeRunner::new();
        deny_listing(&runner);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_fail("");
        runner.enqueue_fail("run-as: package not debuggable: com.x");
        let msg = list_databases(&runner, "R5CT91", "com.x")
            .unwrap_err()
            .to_string();
        assert!(msg.contains("run-as: package not debuggable: com.x"), "{msg}");
        assert!(msg.contains("Permission denied"), "{msg}");
        assert!(msg.contains("Magisk"), "{msg}");
    }

    #[test]
    fn emulator_listing_never_falls_back() {
        let runner = FakeRunner::new();
        deny_listing(&runner);
        assert!(list_databases(&runner, "emulator-5554", "com.x").is_err());
        assert_eq!(runner.calls.lock().unwrap().len(), 2);
    }

    #[test]
    fn phone_pull_uses_run_as_with_wal_and_shm() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(DENIED);
        runner.enqueue_fail(NO_ROOT);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_fail("");
        for body in ["main", "wal!!", "shm"] {
            runner.enqueue_ok(&body.len().to_string());
            runner.enqueue_ok(body);
        }
        let dest = temp_dest("run-as");
        let info = pull_snapshot(&runner, "R5CT91", "com.x", "app.db", &dest).unwrap();
        assert_eq!(std::fs::read(&info.local_path).unwrap(), b"main");
        assert_eq!(
            std::fs::read(format!("{}-wal", info.local_path)).unwrap(),
            b"wal!!"
        );
        assert_eq!(info.size_bytes, 12);
        let calls = runner.calls.lock().unwrap();
        assert!(calls.iter().any(|c| c[2..]
            == ["exec-out", "run-as com.x cat databases/app.db-shm"]));
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn phone_pull_rejects_a_truncated_copy() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(DENIED);
        runner.enqueue_fail(NO_ROOT);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_fail("");
        runner.enqueue_ok("4096");
        runner.enqueue_ok("run-as: boom");
        let dest = temp_dest("truncated");
        let msg = pull_snapshot(&runner, "R5CT91", "com.x", "app.db", &dest)
            .unwrap_err()
            .to_string();
        assert!(msg.contains("expected 4096 bytes"), "{msg}");
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn phone_pull_uses_su_and_removes_the_staging_copy() {
        let runner = FakeRunner::new();
        runner.enqueue_fail(DENIED);
        runner.enqueue_fail(NO_ROOT);
        runner.enqueue_ok("uid=2000(shell)");
        runner.enqueue_ok("/system/bin/su");
        runner.enqueue_ok("uid=0(root)");
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        runner.enqueue_ok("pulled");
        runner.enqueue_ok("");
        runner.enqueue_ok("pulled");
        runner.enqueue_fail("No such file");
        runner.enqueue_ok("");
        let dest = temp_dest("su");
        pull_snapshot(&runner, "R5CT91", "com.x", "app.db", &dest).unwrap();
        let shell = shell_commands(&runner);
        assert!(shell.iter().any(|c| c.starts_with("su -c ")
            && c.contains("cp /data/data/com.x/databases/app.db-wal ")));
        assert_eq!(
            shell.last().unwrap(),
            "su -c 'rm -rf /data/local/tmp/beholder-db/com.x'"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn wireless_serials_are_valid_and_safe_as_folder_names() {
        let dir = snapshot_dir(Path::new("/tmp"), "192.168.1.20:5555", "com.x", "app.db").unwrap();
        assert_eq!(dir, Path::new("/tmp/192.168.1.20_5555/com.x/app.db"));
    }
}
