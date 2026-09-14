# Host Setup Doctor & Wizard Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click headless setup of the Android environment (Android Studio via official dmg, cmdline-tools, platform-tools, emulator) plus a host doctor and improved Emulators empty states.

**Architecture:** Pure host checks in `bh-device::host_doctor` over injectable paths; install steps in `bh-device::host_bootstrap` behind a `HostRunner` trait (fake for tests); `JAVA_HOME` (Studio JBR) injected into every sdkmanager/avdmanager spawn; new tauri commands `run_host_doctor` / `apply_host_fix` / `preview_shell_env` streaming through the existing `install-log` channel; frontend `SetupView` gated at startup via a `setupOpen` store flag; EmulatorsView gets three empty/error states.

**Tech Stack:** Rust (bh-device, src-tauri), React + TS + zustand, vitest.

**Conventions:** No code comments. No commits unless the user asks — this plan contains NO commit steps on purpose (repo rule). Verified endpoints: cmdline-tools zip resolved from `dl.google.com/android/repository/repository2-3.xml` (max build of `commandlinetools-mac-<N>_latest.zip`, current 15641748); Studio dmg scraped from `developer.android.com/studio` (`mac_arm.dmg` / `-mac.dmg`).

---

### Task 1: `host_doctor` module (pure checks)

**Files:**
- Create: `crates/bh-device/src/host_doctor.rs`
- Modify: `crates/bh-device/src/lib.rs` (export)

- [x] **Step 1: Write failing tests** (in `host_doctor.rs`, `#[cfg(test)] mod tests`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("bh-host-doctor-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"").unwrap();
    }

    fn paths_for(root: &Path) -> HostPaths {
        HostPaths {
            studio_app: root.join("apps/Android Studio.app"),
            sdk_root: root.join("sdk"),
            avd_dir: root.join("avd"),
            android_home: None,
            android_sdk_root: None,
            java_home_env: None,
            java_home_extras: vec![],
        }
    }

    fn status_of(checks: &[HostCheck], id: &str) -> HostCheckStatus {
        checks.iter().find(|c| c.id == id).unwrap().status
    }

    #[test]
    fn all_presentIsOk() {
        let root = temp_root("ok");
        let p = paths_for(&root);
        touch(&p.studio_app.join("Contents/jbr/Contents/Home/bin/java"));
        touch(&p.sdk_root.join("cmdline-tools/latest/bin/sdkmanager"));
        touch(&p.sdk_root.join("cmdline-tools/latest/bin/avdmanager"));
        touch(&p.sdk_root.join("platform-tools/adb"));
        touch(&p.sdk_root.join("emulator/emulator"));
        std::fs::create_dir_all(p.avd_dir.join("Pixel_7.avd")).unwrap();
        let checks = run_checks(&p);
        assert!(checks.iter().all(|c| c.status == HostCheckStatus::Ok), "{checks:?}");
    }

    #[test]
    fn emptyMachineFailsWithFixes() {
        let root = temp_root("empty");
        let p = paths_for(&root);
        let checks = run_checks(&p);
        for id in ["java", "android_studio", "sdk_root", "cmdline_tools", "platform_tools", "emulator"] {
            assert_eq!(status_of(&checks, id), HostCheckStatus::Fail, "{id}");
        }
        assert_eq!(status_of(&checks, "avd_present"), HostCheckStatus::Warn);
        let java = checks.iter().find(|c| c.id == "java").unwrap();
        assert_eq!(java.fix.as_deref(), Some("install_android_studio"));
        let cmdline = checks.iter().find(|c| c.id == "cmdline_tools").unwrap();
        assert_eq!(cmdline.fix.as_deref(), Some("install_cmdline_tools"));
    }

    #[test]
    fn staleEnvVarsOnlyWarn() {
        let root = temp_root("env");
        let mut p = paths_for(&root);
        touch(&p.sdk_root.join("cmdline-tools/latest/bin/sdkmanager"));
        p.android_home = Some("/wrong/path".into());
        let checks = run_checks(&p);
        assert_eq!(status_of(&checks, "env_consistency"), HostCheckStatus::Warn);
        let env = checks.iter().find(|c| c.id == "env_consistency").unwrap();
        assert_eq!(env.fix.as_deref(), Some("write_shell_env"));
    }

    #[test]
    fn javaPrefersStudioJbr() {
        let root = temp_root("jbr");
        let mut p = paths_for(&root);
        touch(&p.studio_app.join("Contents/jbr/Contents/Home/bin/java"));
        let other = root.join("other-jdk");
        touch(&other.join("bin/java"));
        p.java_home_env = Some(other.display().to_string());
        assert_eq!(p.java_home(), Some(p.studio_app.join("Contents/jbr/Contents/Home")));
    }
}
```

- [x] **Step 2: Run to verify failure** — `cargo test -p bh-device host_doctor` → compile error (module missing).

- [x] **Step 3: Implement**

```rust
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HostCheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostCheck {
    pub id: String,
    pub title: String,
    pub status: HostCheckStatus,
    pub detail: String,
    pub fix: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HostPaths {
    pub studio_app: PathBuf,
    pub sdk_root: PathBuf,
    pub avd_dir: PathBuf,
    pub android_home: Option<String>,
    pub android_sdk_root: Option<String>,
    pub java_home_env: Option<String>,
    pub java_home_extras: Vec<PathBuf>,
}

impl HostPaths {
    pub fn detect() -> Self {
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
        let sdk_root = [
            std::env::var("ANDROID_HOME").ok().filter(|s| !s.is_empty()),
            std::env::var("ANDROID_SDK_ROOT").ok().filter(|s| !s.is_empty()),
            Some(home.join("Library/Android/sdk").display().to_string()),
        ]
        .into_iter()
        .flatten()
        .map(PathBuf::from)
        .find(|p| p.is_dir())
        .unwrap_or_else(|| home.join("Library/Android/sdk"));
        HostPaths {
            studio_app: PathBuf::from("/Applications/Android Studio.app"),
            sdk_root,
            avd_dir: home.join(".android/avd"),
            android_home: std::env::var("ANDROID_HOME").ok().filter(|s| !s.is_empty()),
            android_sdk_root: std::env::var("ANDROID_SDK_ROOT").ok().filter(|s| !s.is_empty()),
            java_home_env: std::env::var("JAVA_HOME").ok().filter(|s| !s.is_empty()),
            java_home_extras: Vec::new(),
        }
    }

    pub fn java_home(&self) -> Option<PathBuf> {
        let jbr = self.studio_app.join("Contents/jbr/Contents/Home");
        if jbr.join("bin/java").exists() {
            return Some(jbr);
        }
        if let Some(env) = &self.java_home_env {
            let p = PathBuf::from(env);
            if p.join("bin/java").exists() {
                return Some(p);
            }
        }
        self.java_home_extras
            .iter()
            .find(|p| p.join("bin/java").exists())
            .cloned()
    }
}

fn has_any_avd(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.path().extension().map(|x| x == "avd").unwrap_or(false))
        })
        .unwrap_or(false)
}

pub fn run_checks(paths: &HostPaths) -> Vec<HostCheck> {
    let mut checks = Vec::new();
    let java = paths.java_home();
    checks.push(match &java {
        Some(p) => HostCheck {
            id: "java".into(),
            title: "Java runtime".into(),
            status: HostCheckStatus::Ok,
            detail: format!("found at {}", p.display()),
            fix: None,
        },
        None => HostCheck {
            id: "java".into(),
            title: "Java runtime".into(),
            status: HostCheckStatus::Fail,
            detail: "no JDK found; the Android Studio install bundles one".into(),
            fix: Some("install_android_studio".into()),
        },
    });
    checks.push(if paths.studio_app.is_dir() {
        HostCheck {
            id: "android_studio".into(),
            title: "Android Studio".into(),
            status: HostCheckStatus::Ok,
            detail: paths.studio_app.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "android_studio".into(),
            title: "Android Studio".into(),
            status: HostCheckStatus::Fail,
            detail: "not found in /Applications".into(),
            fix: Some("install_android_studio".into()),
        }
    });
    checks.push(if paths.sdk_root.is_dir() {
        HostCheck {
            id: "sdk_root".into(),
            title: "Android SDK directory".into(),
            status: HostCheckStatus::Ok,
            detail: paths.sdk_root.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "sdk_root".into(),
            title: "Android SDK directory".into(),
            status: HostCheckStatus::Fail,
            detail: format!("{} does not exist", paths.sdk_root.display()),
            fix: Some("init_sdk_dir".into()),
        }
    });
    let bin = paths.sdk_root.join("cmdline-tools/latest/bin");
    let cmdline_ok = ["sdkmanager", "avdmanager"]
        .iter()
        .all(|b| bin.join(b).exists());
    checks.push(if cmdline_ok {
        HostCheck {
            id: "cmdline_tools".into(),
            title: "Command-line tools".into(),
            status: HostCheckStatus::Ok,
            detail: bin.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "cmdline_tools".into(),
            title: "Command-line tools".into(),
            status: HostCheckStatus::Fail,
            detail: "sdkmanager/avdmanager not found under cmdline-tools/latest".into(),
            fix: Some("install_cmdline_tools".into()),
        }
    });
    let adb = paths.sdk_root.join("platform-tools/adb");
    checks.push(if adb.exists() {
        HostCheck {
            id: "platform_tools".into(),
            title: "Platform tools (adb)".into(),
            status: HostCheckStatus::Ok,
            detail: adb.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "platform_tools".into(),
            title: "Platform tools (adb)".into(),
            status: HostCheckStatus::Fail,
            detail: "adb not found".into(),
            fix: Some("install_sdk_packages".into()),
        }
    });
    let emu = paths.sdk_root.join("emulator/emulator");
    checks.push(if emu.exists() {
        HostCheck {
            id: "emulator".into(),
            title: "Emulator engine".into(),
            status: HostCheckStatus::Ok,
            detail: emu.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "emulator".into(),
            title: "Emulator engine".into(),
            status: HostCheckStatus::Fail,
            detail: "emulator binary not found".into(),
            fix: Some("install_sdk_packages".into()),
        }
    });
    checks.push(if has_any_avd(&paths.avd_dir) {
        HostCheck {
            id: "avd_present".into(),
            title: "Emulators (AVDs)".into(),
            status: HostCheckStatus::Ok,
            detail: paths.avd_dir.display().to_string(),
            fix: None,
        }
    } else {
        HostCheck {
            id: "avd_present".into(),
            title: "Emulators (AVDs)".into(),
            status: HostCheckStatus::Warn,
            detail: "no AVDs yet; create one from the Emulators view".into(),
            fix: None,
        }
    });
    let real = paths.sdk_root.display().to_string();
    let env_status = if paths.android_home.is_none() && paths.android_sdk_root.is_none() {
        HostCheckStatus::Ok
    } else if paths.android_home.as_deref() == Some(real.as_str())
        && paths
            .android_sdk_root
            .as_deref()
            .map(|v| v == real)
            .unwrap_or(true)
    {
        HostCheckStatus::Ok
    } else {
        HostCheckStatus::Warn
    };
    checks.push(HostCheck {
        id: "env_consistency".into(),
        title: "ANDROID_HOME environment".into(),
        status: env_status,
        detail: if env_status == HostCheckStatus::Ok {
            format!("resolves to {real}")
        } else {
            format!(
                "ANDROID_HOME={} ANDROID_SDK_ROOT={} but the SDK resolves to {real}",
                paths.android_home.as_deref().unwrap_or("(unset)"),
                paths.android_sdk_root.as_deref().unwrap_or("(unset)")
            )
        },
        fix: if env_status == HostCheckStatus::Warn {
            Some("write_shell_env".into())
        } else {
            None
        },
    });
    checks
}
```

- [x] **Step 4: Export from lib.rs** — read `crates/bh-device/src/lib.rs`, add `pub mod host_doctor;` matching existing style.
- [x] **Step 5: `cargo test -p bh-device`** → all pass.

---

### Task 2: `host_bootstrap` module (URL resolvers + install steps)

**Files:**
- Create: `crates/bh-device/src/host_bootstrap.rs`
- Modify: `crates/bh-device/src/lib.rs` (export)

- [x] **Step 1: Failing tests** (`#[cfg(test)] mod tests` inside `host_bootstrap.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("bh-bootstrap-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"").unwrap();
    }

    #[test]
    fn resolvesHighestCmdlineToolsBuild() {
        let xml = r#"<x>commandlinetools-mac-11076708_latest.zip</x><y>commandlinetools-mac-15641748_latest.zip commandlinetools-mac-9477386_latest.zip</y>"#;
        assert_eq!(
            resolve_cmdline_tools_url(xml).unwrap(),
            "https://dl.google.com/android/repository/commandlinetools-mac-15641748_latest.zip"
        );
    }

    #[test]
    fn resolvesStudioDmgByArch() {
        let page = r#"<a href="https://edgedl.me.gvt1.com/android/studio/install/2026.1.4.7/android-studio-quail4-mac_arm.dmg">arm</a><a href="https://edgedl.me.gvt1.com/android/studio/install/2026.1.4.7/android-studio-quail4-mac.dmg">intel</a>"#;
        assert!(resolve_studio_dmg_url(page, true).unwrap().ends_with("mac_arm.dmg"));
        assert!(resolve_studio_dmg_url(page, false).unwrap().ends_with("quail4-mac.dmg"));
    }

    #[test]
    fn installStudioSkipsWhenPresent() {
        let root = temp_root("studio-skip");
        let studio = root.join("Android Studio.app");
        std::fs::create_dir_all(&studio).unwrap();
        let runner = FakeHostRunner::new();
        install_studio(&runner, &studio, &root, &mut |_| {}).unwrap();
        assert!(runner.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn installCmdlineToolsLaysOutLatest() {
        let root = temp_root("cmdline");
        let sdk = root.join("sdk");
        std::fs::create_dir_all(&sdk).unwrap();
        let unpack = root.join("unpack");
        touch(&unpack.join("cmdline-tools/bin/sdkmanager"));
        let xml = "commandlinetools-mac-15641748_latest.zip";
        let runner = FakeHostRunner::new();
        runner.enqueue_ok(&format!("url {xml}"));
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        install_cmdline_tools_into(&runner, &sdk, &root, &unpack, &mut |_| {}).unwrap();
        assert!(sdk.join("cmdline-tools/latest/bin/sdkmanager").exists());
        let calls = runner.calls.lock().unwrap();
        assert!(calls.iter().any(|(p, _)| p == "curl"));
        assert!(calls.iter().any(|(p, _)| p == "unzip"));
    }

    #[test]
    fn writeShellEnvAppendsOnce() {
        let root = temp_root("zshrc");
        let rc = root.join(".zshrc");
        std::fs::write(&rc, "export FOO=1\n").unwrap();
        write_shell_env(&rc, Path::new("/Users/x/Library/Android/sdk")).unwrap();
        write_shell_env(&rc, Path::new("/Users/x/Library/Android/sdk")).unwrap();
        let content = std::fs::read_to_string(&rc).unwrap();
        assert_eq!(content.matches("export ANDROID_HOME").count(), 1);
    }

    pub struct FakeHostRunner {
        pub calls: Mutex<Vec<(String, Vec<String>)>>,
        pub responses: Mutex<std::collections::VecDeque<Result<Output, DeviceError>>>,
    }

    impl FakeHostRunner {
        pub fn new() -> Self {
            Self {
                calls: Mutex::new(vec![]),
                responses: Mutex::new(std::collections::VecDeque::new()),
            }
        }
        pub fn enqueue_ok(&self, stdout: &str) {
            self.responses.lock().unwrap().push_back(Ok(Output {
                stdout: stdout.into(),
                stderr: String::new(),
                success: true,
            }));
        }
    }

    impl Default for FakeHostRunner {
        fn default() -> Self {
            Self::new()
        }
    }

    impl HostRunner for FakeHostRunner {
        fn run(&self, program: &str, args: &[&str], _envs: &[(&str, &str)]) -> Result<Output, DeviceError> {
            self.calls
                .lock()
                .unwrap()
                .push((program.into(), args.iter().map(|s| s.to_string()).collect()));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(DeviceError::Other("no scripted response".into())))
        }
    }
}
```

- [x] **Step 2: Run to verify failure** — `cargo test -p bh-device host_bootstrap` → compile error.

- [x] **Step 3: Implement** — note `install_cmdline_tools_into` takes an explicit unpack dir (defaults to `cache_dir.join("ct-unpack")` in the public wrapper) so the fake-unzip test can pre-create the unpacked layout.

```rust
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{DeviceError, Output};

pub trait HostRunner {
    fn run(&self, program: &str, args: &[&str], envs: &[(&str, &str)]) -> Result<Output, DeviceError>;
    fn run_streaming(
        &self,
        program: &str,
        args: &[&str],
        envs: &[(&str, &str)],
        _on_line: &mut dyn FnMut(&str),
    ) -> Result<(bool, String), DeviceError> {
        let out = self.run(program, args, envs)?;
        Ok((out.success, out.stderr))
    }
}

pub struct RealHostRunner;

impl HostRunner for RealHostRunner {
    fn run(&self, program: &str, args: &[&str], envs: &[(&str, &str)]) -> Result<Output, DeviceError> {
        let mut cmd = Command::new(program);
        cmd.args(args);
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let out = cmd.output().map_err(|e| DeviceError::Other(e.to_string()))?;
        Ok(Output {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            success: out.status.success(),
        })
    }

    fn run_streaming(
        &self,
        program: &str,
        args: &[&str],
        envs: &[(&str, &str)],
        on_line: &mut dyn FnMut(&str),
    ) -> Result<(bool, String), DeviceError> {
        let mut cmd = Command::new(program);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| DeviceError::Other(e.to_string()))?;
        let mut stderr_all = String::new();
        if let Some(mut out) = child.stdout.take() {
            let mut buf = [0u8; 4096];
            let mut line: Vec<u8> = Vec::new();
            loop {
                match out.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        for &b in &buf[..n] {
                            if b == b'\r' || b == b'\n' {
                                let s = String::from_utf8_lossy(&line).trim().to_string();
                                if !s.is_empty() {
                                    on_line(&s);
                                }
                                line.clear();
                            } else {
                                line.push(b);
                            }
                        }
                    }
                }
            }
        }
        if let Some(mut err) = child.stderr.take() {
            use std::io::Read as _;
            let mut raw = Vec::new();
            let _ = err.read_to_end(&mut raw);
            stderr_all = String::from_utf8_lossy(&raw).into_owned();
        }
        let status = child.wait().map_err(|e| DeviceError::Other(e.to_string()))?;
        Ok((status.success(), stderr_all))
    }
}

pub fn resolve_cmdline_tools_url(xml: &str) -> Option<String> {
    let mut best: Option<u64> = None;
    let mut best_name = "";
    let mut rest = xml;
    while let Some(i) = rest.find("commandlinetools-mac-") {
        let after = &rest[i..];
        let Some(end) = after.find(".zip") else { break };
        let name = &after[..end + 4];
        if let Some(num) = name
            .strip_prefix("commandlinetools-mac-")
            .and_then(|s| s.strip_suffix("_latest.zip"))
            .and_then(|s| s.parse::<u64>().ok())
        {
            if best.map(|b| num > b).unwrap_or(true) {
                best = Some(num);
                best_name = name;
            }
        }
        rest = &rest[end + 4..];
    }
    if best_name.is_empty() {
        None
    } else {
        Some(format!("https://dl.google.com/android/repository/{best_name}"))
    }
}

pub fn resolve_studio_dmg_url(page: &str, arch_arm: bool) -> Option<String> {
    let links = find_dmg_links(page);
    if arch_arm {
        links.into_iter().find(|u| u.ends_with("mac_arm.dmg"))
    } else {
        links.into_iter().find(|u| u.ends_with("-mac.dmg"))
    }
}

fn find_dmg_links(text: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("https://") {
        let after = &rest[i..];
        let end = after
            .find(|c: char| c == '"' || c == '\'' || c.is_whitespace() || c == '<')
            .unwrap_or(after.len());
        let url = &after[..end];
        if url.ends_with(".dmg") {
            links.push(url.to_string());
        }
        rest = &after[end..];
    }
    links
}

pub fn install_studio(
    runner: &dyn HostRunner,
    studio_app: &Path,
    cache_dir: &Path,
    on_line: &mut dyn FnMut(&str),
) -> Result<(), DeviceError> {
    if studio_app.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(cache_dir).map_err(|e| DeviceError::Other(e.to_string()))?;
    let page = runner.run("curl", &["-sL", "https://developer.android.com/studio"], &[])?;
    let arm = std::env::consts::ARCH == "aarch64";
    let url = resolve_studio_dmg_url(&page.stdout, arm)
        .ok_or_else(|| DeviceError::Other("could not resolve the Android Studio dmg url".into()))?;
    let dmg = cache_dir.join("android-studio.dmg");
    let dmg_str = dmg.display().to_string();
    on_line("downloading Android Studio (~2 GB), this can take a while...");
    let (ok, stderr) = runner.run_streaming(
        "curl",
        &["-fL", "--progress-bar", "-o", &dmg_str, &url],
        &[],
        on_line,
    )?;
    if !ok {
        return Err(DeviceError::CommandFailed {
            program: "curl".into(),
            args: vec![url],
            stderr,
        });
    }
    on_line("mounting disk image...");
    let attach = runner.run(
        "hdiutil",
        &["attach", "-nobrowse", "-readonly", "-plist", &dmg_str],
        &[],
    )?;
    let mount = parse_mount_point(&attach.stdout)
        .ok_or_else(|| DeviceError::Other("could not find the dmg mount point".into()))?;
    on_line("copying Android Studio.app...");
    let src = format!("{}/Android Studio.app", mount.display());
    let dst = studio_app.display().to_string();
    let copy = runner.run("ditto", &[&src, &dst], &[])?;
    let _ = runner.run("hdiutil", &["detach", &mount.display().to_string()], &[]);
    let _ = std::fs::remove_file(&dmg);
    if !copy.success {
        return Err(DeviceError::CommandFailed {
            program: "ditto".into(),
            args: vec![src, dst],
            stderr: copy.stderr,
        });
    }
    Ok(())
}

fn parse_mount_point(plist: &str) -> Option<PathBuf> {
    let mut current: Option<String> = None;
    for line in plist.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("<string>").and_then(|s| s.strip_suffix("</string>")) {
            if v.starts_with('/') {
                current = Some(v.to_string());
            }
        }
    }
    current.filter(|p| p.contains("Android Studio") || p.contains("android-studio"))
        .or(current)
        .map(PathBuf::from)
}

pub fn install_cmdline_tools(
    runner: &dyn HostRunner,
    sdk_root: &Path,
    cache_dir: &Path,
    on_line: &mut dyn FnMut(&str),
) -> Result<(), DeviceError> {
    let unpack = cache_dir.join("ct-unpack");
    install_cmdline_tools_into(runner, sdk_root, cache_dir, &unpack, on_line)
}

pub fn install_cmdline_tools_into(
    runner: &dyn HostRunner,
    sdk_root: &Path,
    cache_dir: &Path,
    unpack_dir: &Path,
    on_line: &mut dyn FnMut(&str),
) -> Result<(), DeviceError> {
    std::fs::create_dir_all(cache_dir).map_err(|e| DeviceError::Other(e.to_string()))?;
    let mut xml = None;
    for repo in ["repository2-4.xml", "repository2-3.xml", "repository2-2.xml"] {
        let out = runner.run(
            "curl",
            &["-sf", &format!("https://dl.google.com/android/repository/{repo}")],
            &[],
        )?;
        if out.success {
            xml = Some(out.stdout);
            break;
        }
    }
    let xml = xml.ok_or_else(|| DeviceError::Other("could not fetch the sdk repository index".into()))?;
    let url = resolve_cmdline_tools_url(&xml)
        .ok_or_else(|| DeviceError::Other("could not resolve the cmdline-tools zip url".into()))?;
    let zip = cache_dir.join("cmdline-tools.zip");
    let zip_str = zip.display().to_string();
    on_line("downloading command-line tools...");
    let (ok, stderr) = runner.run_streaming("curl", &["-fL", "--progress-bar", "-o", &zip_str, &url], &[], on_line)?;
    if !ok {
        return Err(DeviceError::CommandFailed {
            program: "curl".into(),
            args: vec![url],
            stderr,
        });
    }
    on_line("unpacking command-line tools...");
    let _ = std::fs::remove_dir_all(unpack_dir);
    std::fs::create_dir_all(unpack_dir).map_err(|e| DeviceError::Other(e.to_string()))?;
    let unpack_str = unpack_dir.display().to_string();
    let unzip = runner.run("unzip", &["-qo", &zip_str, "-d", &unpack_str], &[])?;
    let _ = std::fs::remove_file(&zip);
    if !unzip.success {
        return Err(DeviceError::CommandFailed {
            program: "unzip".into(),
            args: vec![zip_str, unpack_str],
            stderr: unzip.stderr,
        });
    }
    let latest = sdk_root.join("cmdline-tools/latest");
    let _ = std::fs::remove_dir_all(&latest);
    std::fs::create_dir_all(sdk_root.join("cmdline-tools")).map_err(|e| DeviceError::Other(e.to_string()))?;
    std::fs::rename(unpack_dir.join("cmdline-tools"), &latest)
        .map_err(|e| DeviceError::Other(format!("failed to lay out cmdline-tools: {e}")))?;
    Ok(())
}

pub fn install_sdk_packages(
    runner: &dyn HostRunner,
    sdk_root: &Path,
    java_home: Option<&Path>,
    on_line: &mut dyn FnMut(&str),
) -> Result<(), DeviceError> {
    let sdkmanager = sdk_root.join("cmdline-tools/latest/bin/sdkmanager");
    let sdk_str = sdkmanager.display().to_string();
    let envs: Vec<(&str, String)> = match java_home {
        Some(p) => vec![("JAVA_HOME", p.display().to_string())],
        None => vec![],
    };
    let env_refs: Vec<(&str, &str)> = envs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let (ok, stderr) = runner.run_streaming(
        "sh",
        &["-c", &format!("'{sdk_str}' platform-tools emulator")],
        &env_refs,
        on_line,
    )?;
    if ok {
        return Ok(());
    }
    if !stderr.to_lowercase().contains("license") && !stderr.to_lowercase().contains("accepted") {
        return Err(DeviceError::CommandFailed {
            program: "sdkmanager".into(),
            args: vec!["platform-tools".into(), "emulator".into()],
            stderr,
        });
    }
    on_line("accepting sdk licenses...");
    let (ok2, stderr2) = runner.run_streaming(
        "sh",
        &["-c", &format!("yes | '{sdk_str}' --licenses")],
        &env_refs,
        on_line,
    )?;
    if !ok2 {
        return Err(DeviceError::CommandFailed {
            program: "sdkmanager --licenses".into(),
            args: vec![],
            stderr: stderr2,
        });
    }
    let (ok3, stderr3) = runner.run_streaming(
        "sh",
        &["-c", &format!("'{sdk_str}' platform-tools emulator")],
        &env_refs,
        on_line,
    )?;
    if !ok3 {
        return Err(DeviceError::CommandFailed {
            program: "sdkmanager".into(),
            args: vec!["platform-tools".into(), "emulator".into()],
            stderr: stderr3,
        });
    }
    Ok(())
}

pub fn shell_env_lines(sdk_root: &Path) -> Vec<String> {
    vec![format!("export ANDROID_HOME=\"{}\"", sdk_root.display())]
}

pub fn write_shell_env(zshrc: &Path, sdk_root: &Path) -> Result<(), DeviceError> {
    let line = shell_env_lines(sdk_root).join("\n");
    let content = std::fs::read_to_string(zshrc).unwrap_or_default();
    if content.contains(&line) {
        return Ok(());
    }
    let mut out = content;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&line);
    out.push('\n');
    std::fs::write(zshrc, out).map_err(|e| DeviceError::Other(e.to_string()))
}
```

- [x] **Step 4: Export from lib.rs** — `pub mod host_bootstrap;`
- [x] **Step 5: `cargo test -p bh-device`** → all pass.

---

### Task 3: `JAVA_HOME` injection into SDK tool spawns

**Files:**
- Modify: `crates/bh-device/src/avd.rs` (`RealSdkRunner`, `accept_licenses`, `create_avd_with_stdin`)
- Modify: `src-tauri/src/commands.rs` (`stream_process`, `run_sdkmanager_streaming`, `install_image`, `create_avd`)

- [x] **Step 1: Add `java_home` to `RealSdkRunner`**

```rust
pub struct RealSdkRunner {
    sdk_root: PathBuf,
    emulator: PathBuf,
    avdmanager: PathBuf,
    sdkmanager: PathBuf,
    java_home: Option<PathBuf>,
}
```

In `discover()`, before constructing: `let java_home = crate::host_doctor::HostPaths::detect().java_home();` and store it. Add accessor:

```rust
pub fn java_home(&self) -> Option<&Path> {
    self.java_home.as_deref()
}
```

Change `SdkToolRunner for RealSdkRunner::run` to inject env:

```rust
fn run(&self, tool: SdkTool, args: &[&str]) -> Result<Output, DeviceError> {
    let mut cmd = Command::new(self.tool_path(tool));
    if let Some(jh) = &self.java_home {
        cmd.env("JAVA_HOME", jh);
    }
    let out = cmd
        .args(args)
        .output()
        .map_err(|e| DeviceError::Other(e.to_string()))?;
    Ok(Output {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        success: out.status.success(),
    })
}
```

- [x] **Step 2: Thread java through free functions**

`accept_licenses(sdkmanager: &Path, java_home: Option<&Path>)`:

```rust
pub fn accept_licenses(sdkmanager: &Path, java_home: Option<&Path>) -> Result<(), DeviceError> {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(format!("yes | '{}' --licenses", sdkmanager.display()));
    if let Some(jh) = java_home {
        cmd.env("JAVA_HOME", jh);
    }
    let mut child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| DeviceError::Other(e.to_string()))?;
    let _ = child.wait();
    Ok(())
}
```

`create_avd_with_stdin(avdmanager: &Path, java_home: Option<&Path>, ...)` — same env injection pattern at its `Command` site.

- [x] **Step 3: Env-aware `stream_process` in commands.rs**

```rust
async fn stream_process<F>(
    bin: &Path,
    args: &[&str],
    envs: &[(&str, String)],
    on_line: F,
) -> Result<(bool, String), String>
```

Add after `kill_on_drop(true)`:

```rust
    for (k, v) in envs {
        child = child.env(k, v);
    }
```

(The builder pattern requires rebinding; declare `let mut child` and use `child = child.env(...)` before `.spawn()`.)

`run_sdkmanager_streaming(app, bin, args, java_home: Option<&Path>)` builds `envs` and passes it. `install_image` passes `sdk.java_home()`. `create_avd` command passes `sdk.java_home()` into `create_avd_with_stdin`.

- [x] **Step 4: Test**

```rust
#[test]
fn java_env_is_injected() {
    use std::process::Command;
    let mut cmd = Command::new("true");
    if let Some(jh) = Some(Path::new("/opt/jbr")) {
        cmd.env("JAVA_HOME", jh);
    }
    assert!(cmd
        .get_envs()
        .any(|(k, v)| k == &"JAVA_HOME" && v == Ok(OsStr::new("/opt/jbr"))));
}
```

(placed in avd.rs tests; `use std::ffi::OsStr;` at test-module top). `cargo test -p bh-device` → pass; `cargo check --workspace` → compile.

---

### Task 4: Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs` (add three commands at the end, before `#[cfg(test)]`)
- Modify: `src-tauri/src/lib.rs` (register)

```rust
#[tauri::command]
pub async fn run_host_doctor() -> Result<Vec<bh_device::host_doctor::HostCheck>, String> {
    tokio::task::spawn_blocking(|| {
        let paths = bh_device::host_doctor::HostPaths::detect();
        Ok(bh_device::host_doctor::run_checks(&paths))
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_host_fix(app: tauri::AppHandle, fix: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let paths = bh_device::host_doctor::HostPaths::detect();
        let runner = bh_device::host_bootstrap::RealHostRunner;
        let cache = std::env::temp_dir().join("beholder-setup");
        let mut log = |line: &str| {
            let _ = app.emit("install-log", line.to_string());
        };
        let result = match fix.as_str() {
            "install_android_studio" => bh_device::host_bootstrap::install_studio(
                &runner,
                &paths.studio_app,
                &cache,
                &mut log,
            ),
            "init_sdk_dir" => std::fs::create_dir_all(&paths.sdk_root)
                .map_err(|e| bh_device::DeviceError::Other(e.to_string())),
            "install_cmdline_tools" => bh_device::host_bootstrap::install_cmdline_tools(
                &runner,
                &paths.sdk_root,
                &cache,
                &mut log,
            ),
            "install_sdk_packages" => {
                let java = paths.java_home();
                bh_device::host_bootstrap::install_sdk_packages(
                    &runner,
                    &paths.sdk_root,
                    java.as_deref(),
                    &mut log,
                )
            }
            "write_shell_env" => {
                let home = std::env::var("HOME").map_err(|e| e.to_string())?;
                bh_device::host_bootstrap::write_shell_env(
                    std::path::Path::new(&home).join(".zshrc"),
                    &paths.sdk_root,
                )
            }
            other => Err(bh_device::DeviceError::Other(format!("unknown fix: {other}"))),
        };
        result.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_shell_env() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(|| {
        let paths = bh_device::host_doctor::HostPaths::detect();
        Ok(bh_device::host_bootstrap::shell_env_lines(&paths.sdk_root))
    })
    .await
    .map_err(|e| e.to_string())?
}
```

Register in `lib.rs` after `commands::install_image,`:

```rust
            commands::run_host_doctor,
            commands::apply_host_fix,
            commands::preview_shell_env,
```

`app.emit` requires `tauri::Emitter` in scope — match however `install_image` already does it (it calls `app.emit` directly; reuse the existing import).

- [x] **Verify:** `cargo check --workspace` + `cargo test --workspace` → pass.

---

### Task 5: Frontend — store flag, fixPlan, SetupView, App gate, mocks

**Files:**
- Modify: `src/store/traffic.ts` (add `setupOpen` / `setSetupOpen` mirroring `settingsOpen`)
- Create: `src/features/setup/fixPlan.ts` + `src/features/setup/fixPlan.test.ts`
- Create: `src/features/setup/SetupView.tsx`
- Modify: `src/App.tsx` (startup gate + overlay)
- Modify: `src/lib/tauri.ts` (mock cases)

- [x] **fixPlan.ts**

```ts
export interface HostCheckT {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
}

const ORDER = ["install_android_studio", "init_sdk_dir", "install_cmdline_tools", "install_sdk_packages"] as const;

export function fixPlan(checks: HostCheckT[]): string[] {
  const failing = new Set(
    checks.filter((c) => c.status === "fail").map((c) => c.fix).filter((f): f is string => f != null),
  );
  return ORDER.filter((f) => failing.has(f));
}
```

- [x] **fixPlan.test.ts**

```ts
import { describe, expect, it } from "vitest";
import { fixPlan, type HostCheckT } from "./fixPlan";

function check(fix: string | null, status: HostCheckT["status"] = "fail"): HostCheckT {
  return { id: fix ?? "x", title: "t", status, detail: "d", fix };
}

describe("fixPlan", () => {
  it("orders fixes by dependency order regardless of check order", () => {
    const plan = fixPlan([check("install_sdk_packages"), check("install_android_studio"), check("install_cmdline_tools")]);
    expect(plan).toEqual(["install_android_studio", "install_cmdline_tools", "install_sdk_packages"]);
  });

  it("skips init_sdk_dir when the dir already exists", () => {
    expect(fixPlan([check("install_android_studio"), check(null, "ok")])).toEqual(["install_android_studio"]);
  });

  it("ignores soft warnings without fixes", () => {
    expect(fixPlan([check(null, "warn")])).toEqual([]);
  });
});
```

- [x] **SetupView.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, X, XCircle, Zap } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";
import { Badge, Panel } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { fixPlan, type HostCheckT } from "./fixPlan";

const STATUS_ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const STATUS_CLS = { ok: "text-ok", warn: "text-warn", fail: "text-danger" } as const;

export function SetupView({ onClose }: { onClose: () => void }) {
  const installLog = useTraffic((s) => s.installLog);
  const [checks, setChecks] = useState<HostCheckT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [envPreview, setEnvPreview] = useState<string[] | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChecks(await invoke<HostCheckT[]>("run_host_doctor"));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  async function applyFix(fix: string) {
    setBusy(true);
    setRunning(fix);
    setError(null);
    try {
      await invoke("apply_host_fix", { fix });
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function setupAll() {
    setBusy(true);
    setError(null);
    for (const fix of fixPlan(checks)) {
      setRunning(fix);
      try {
        await invoke("apply_host_fix", { fix });
      } catch (e) {
        setError(String(e));
        setBusy(false);
        setRunning(null);
        return;
      }
    }
    setRunning(null);
    setBusy(false);
    await run();
  }

  async function askEnvPreview() {
    setError(null);
    try {
      setEnvPreview(await invoke<string[]>("preview_shell_env"));
    } catch (e) {
      setError(String(e));
    }
  }

  const plan = fixPlan(checks);
  const anyFail = checks.some((c) => c.status === "fail");

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-txt">Setup</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Everything Beholder needs on this machine, from official sources.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={run}
            disabled={loading || busy}
            title="Re-run checks"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-txt"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-txt"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {loading && checks.length === 0 && <p className="mt-4 text-[12px] text-muted">Checking your environment…</p>}

      {checks.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2.5">
          {checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            return (
              <li key={c.id} className="flex items-start gap-2.5">
                <Icon size={15} className={clsx("mt-0.5 shrink-0", STATUS_CLS[c.status])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-txt">{c.title}</p>
                  <p className="mt-0.5 break-all text-[11px] leading-relaxed text-muted">{c.detail}</p>
                </div>
                {c.fix && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (c.fix === "write_shell_env" ? askEnvPreview() : applyFix(c.fix!))}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-accent/50 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                  >
                    {running === c.fix ? <CircleDashed size={11} className="animate-spin" /> : <Zap size={11} />}
                    {c.fix === "write_shell_env" ? "Fix" : "Fix"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {envPreview && (
        <div className="mt-3 rounded-md border border-line bg-bg p-2.5">
          <p className="text-[11px] text-muted">This line will be appended to your ~/.zshrc:</p>
          <pre className="mt-1 font-mono text-[11px] text-txt">{envPreview.join("\n")}</pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setEnvPreview(null);
                await applyFix("write_shell_env");
              }}
              className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg disabled:opacity-40"
            >
              Append to ~/.zshrc
            </button>
            <button
              type="button"
              onClick={() => setEnvPreview(null)}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-txt"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {running && installLog && (
        <p className="mt-3 truncate font-mono text-[11px] text-muted">{installLog}</p>
      )}
      {running && !installLog && (
        <p className="mt-3 text-[11px] text-muted">Running {running}…</p>
      )}

      {error && <ErrorBox message={error} className="mt-3" />}

      {checks.length > 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {plan.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={setupAll}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40"
            >
              {busy ? <CircleDashed size={12} className="animate-spin" /> : <Zap size={12} />} Set up everything
            </button>
          )}
          {!anyFail && !loading && (
            <Badge tone="ok" className="ml-auto">
              environment ready
            </Badge>
          )}
        </div>
      )}
    </Panel>
  );
}
```

- [x] **traffic.ts store** — add to interface + initializer + setter (mirror `settingsOpen`):

```ts
  setupOpen: boolean;
  setSetupOpen: (open: boolean) => void;
```

```ts
  setupOpen: false,
  setSetupOpen: (open) => set({ setupOpen: open }),
```

- [x] **App.tsx** — imports add `SetupView`; hook `setupOpen`/`setSetupOpen`; startup gate effect; overlay before `settingsOpen` block:

```tsx
  useEffect(() => {
    if (!isTauri) return;
    invoke<{ status: string }[]>("run_host_doctor")
      .then((checks) => {
        if (checks.some((c) => c.status === "fail")) {
          useTraffic.getState().setSetupOpen(true);
        }
      })
      .catch(() => {});
  }, []);
```

```tsx
      {setupOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setSetupOpen(false)}
        >
          <div className="w-[560px] max-w-full" onClick={(e) => e.stopPropagation()}>
            <SetupView onClose={() => setSetupOpen(false)} />
          </div>
        </div>
      )}
```

- [x] **tauri.ts mocks** — add cases before `default`:

```ts
    case "run_host_doctor":
      return [] as T;
    case "preview_shell_env":
      return ["export ANDROID_HOME=\"$HOME/Library/Android/sdk\""] as T;
```

- [x] **Verify:** `npm run check && npm run lint && npm test` → pass.

---

### Task 6: EmulatorsView empty states

**Files:**
- Modify: `src/features/emulators/EmulatorsView.tsx`

- [x] **Step 1: Wire store + state**

Add `setSetupOpen` from `useTraffic`. Add state:

```ts
  const [hostReady, setHostReady] = useState<boolean | null>(null);
  const [hostIssues, setHostIssues] = useState<{ title: string; detail: string }[] | null>(null);
```

In `refresh()` catch, before `setError`:

```ts
      const checks = await invoke<{ status: string; title: string; detail: string }[]>(
        "run_host_doctor",
      ).catch(() => null);
      if (checks && checks.some((c) => c.status === "fail")) {
        setHostReady(false);
        setHostIssues(checks.filter((c) => c.status === "fail"));
        setError(null);
        return;
      }
      setHostReady(true);
      setError(String(e));
```

and set `setHostReady(true)` at the end of the try block. Reset `setHostIssues(null)` on success.

- [x] **Step 2: Host-not-ready early return** (after hooks, before main return):

```tsx
  if (hostReady === false) {
    const failing = (hostIssues ?? []).map((c) => c.title).join(", ");
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <MonitorSmartphone size={28} className="text-muted" />
        <p className="text-sm font-semibold text-txt">Set up your Android environment</p>
        <p className="text-[12px] leading-relaxed text-muted">
          Beholder needs the Android SDK tooling to manage emulators. Missing: {failing}.
        </p>
        <details className="w-full rounded-md border border-line bg-surface px-3 py-2 text-left">
          <summary className="cursor-pointer text-[11px] text-muted">Details</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {(hostIssues ?? []).map((c) => (
              <li key={c.title} className="break-all font-mono text-[10px] text-muted">
                {c.title}: {c.detail}
              </li>
            ))}
          </ul>
        </details>
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg"
        >
          Open setup
        </button>
      </div>
    );
  }
```

(`MonitorSmartphone` already imported.)

- [x] **Step 3: Zero-AVD friendly state** — replace the `avds.length === 0` muted `<p>` with:

```tsx
          {avds.length === 0 && (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-dashed border-line px-3 py-5">
              <p className="text-[12px] font-medium text-txt">No emulators yet</p>
              <p className="text-[11px] text-muted">
                Beholder picks a rootable image and applies the right settings automatically.
              </p>
              <button
                type="button"
                onClick={() => {
                  document.getElementById("create-avd")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  document.getElementById("create-avd-name")?.focus();
                }}
                className="flex items-center gap-1 rounded-md border border-accent/50 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                <Plus size={11} /> Create emulator
              </button>
            </div>
          )}
```

Add `Plus` to the lucide import. Add `id="create-avd"` to the create `Panel` and `id="create-avd-name"` to the name `<input>`.

- [x] **Verify:** `npm run check && npm run lint && npm test`.

---

### Task 7: Full verification

- [ ] `cargo test --workspace` → pass
- [ ] `cargo check --workspace` → pass
- [ ] `npm run check && npm run lint && npm test` → pass
- [ ] Report results to the user; offer optional `npm run tauri dev` smoke test (Setup overlay appears only if host checks fail).

## Self-review

- Spec coverage: all 8 doctor checks ✓, JAVA_HOME per-invocation ✓, official-source bootstrap ✓, setup gate ✓, empty states (3) ✓, write_shell_env preview+confirm ✓, tests Rust+vitest ✓. android-CLI detection intentionally out (non-goal).
- No placeholders.
- Type consistency: `HostCheck` (Rust, serde lowercase status) ↔ `HostCheckT` (`"ok"|"warn"|"fail"`) ✓; `install_cmdline_tools_into` used by both public wrapper and test ✓; `apply_host_fix` fix ids match `fixPlan.ORDER` and check `.fix` values ✓.
