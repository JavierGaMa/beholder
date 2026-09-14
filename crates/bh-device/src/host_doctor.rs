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
    fn all_present_is_ok() {
        let root = temp_root("ok");
        let p = paths_for(&root);
        touch(&p.studio_app.join("Contents/jbr/Contents/Home/bin/java"));
        touch(&p.sdk_root.join("cmdline-tools/latest/bin/sdkmanager"));
        touch(&p.sdk_root.join("cmdline-tools/latest/bin/avdmanager"));
        touch(&p.sdk_root.join("platform-tools/adb"));
        touch(&p.sdk_root.join("emulator/emulator"));
        std::fs::create_dir_all(p.avd_dir.join("Pixel_7.avd")).unwrap();
        let checks = run_checks(&p);
        assert!(
            checks.iter().all(|c| c.status == HostCheckStatus::Ok),
            "{checks:?}"
        );
    }

    #[test]
    fn empty_machine_fails_with_fixes() {
        let root = temp_root("empty");
        let p = paths_for(&root);
        let checks = run_checks(&p);
        for id in [
            "java",
            "android_studio",
            "sdk_root",
            "cmdline_tools",
            "platform_tools",
            "emulator",
        ] {
            assert_eq!(status_of(&checks, id), HostCheckStatus::Fail, "{id}");
        }
        assert_eq!(status_of(&checks, "avd_present"), HostCheckStatus::Warn);
        let java = checks.iter().find(|c| c.id == "java").unwrap();
        assert_eq!(java.fix.as_deref(), Some("install_android_studio"));
        let cmdline = checks.iter().find(|c| c.id == "cmdline_tools").unwrap();
        assert_eq!(cmdline.fix.as_deref(), Some("install_cmdline_tools"));
    }

    #[test]
    fn stale_env_vars_only_warn() {
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
    fn java_prefers_studio_jbr() {
        let root = temp_root("jbr");
        let mut p = paths_for(&root);
        touch(&p.studio_app.join("Contents/jbr/Contents/Home/bin/java"));
        let other = root.join("other-jdk");
        touch(&other.join("bin/java"));
        p.java_home_env = Some(other.display().to_string());
        assert_eq!(
            p.java_home(),
            Some(p.studio_app.join("Contents/jbr/Contents/Home"))
        );
    }
}
