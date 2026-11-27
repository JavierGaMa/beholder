pub mod avd;
pub mod companion;
pub mod doctor;
pub mod host_bootstrap;
pub mod host_doctor;
pub mod probe;
pub mod runner;
pub mod system_ca;
pub mod types;

pub use avd::{
    accept_licenses, create_avd_with_stdin, enrich_avds_from_config, find_aapt,
    launch_emulator_detached, parse_avdmanager_list, parse_badging_package, parse_device_profiles,
    parse_sdkmanager_images, read_apk_package, AvdManager, FakeSdkRunner, RealSdkRunner, SdkTool,
    SdkToolRunner,
};
pub use doctor::{apply_basic_fix, run_checks, CheckStatus, DoctorCheck, FixId};
pub use probe::{
    probe, root_access, tiers, DeviceProbe, RootAccess, Tier, TierState, TierStatus,
    COMPANION_PACKAGE, SU_GRANT_HINT,
};
pub use system_ca::{ensure_system_ca, remove_system_ca, CaOutcome};
pub use runner::{CommandRunner, DeviceError, FakeRunner, Output, RealRunner};
pub use types::{AvdInfo, Device, DeviceState, SystemImage};

pub fn is_emulator_serial(serial: &str) -> bool {
    serial.starts_with("emulator-")
}

pub trait DeviceScanner {
    fn list(&self) -> Result<Vec<Device>, DeviceError>;
}

pub trait CertificateInstaller {
    fn install_system_cert(&self, filename: &str, pem: &str) -> Result<(), DeviceError>;
    fn is_cert_installed(&self, filename: &str, cert_pem: &str) -> Result<bool, DeviceError>;
    fn uninstall_cert(&self, filename: &str) -> Result<(), DeviceError>;
}

pub trait ApkInstaller {
    fn install_apk(&self, path: &str) -> Result<(), DeviceError>;
    fn uninstall(&self, package: &str) -> Result<(), DeviceError>;
}

pub trait ProxyConfigurator {
    fn set_proxy(&self, host: &str, port: u16) -> Result<(), DeviceError>;
    fn clear_proxy(&self) -> Result<(), DeviceError>;
    fn current_proxy(&self) -> Result<Option<String>, DeviceError>;
    fn restore_proxy(&self, previous: Option<&str>) -> Result<(), DeviceError>;
}

pub struct AdbScanner<'a> {
    runner: &'a dyn CommandRunner,
}

impl<'a> AdbScanner<'a> {
    pub fn new(runner: &'a dyn CommandRunner) -> Self {
        AdbScanner { runner }
    }
}

impl<'a> DeviceScanner for AdbScanner<'a> {
    fn list(&self) -> Result<Vec<Device>, DeviceError> {
        let out = self.runner.run(&["devices", "-l"])?;
        let mut devices = vec![];
        for line in out.stdout.lines().skip(1) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let serial = parts.next().unwrap_or_default().to_string();
            let state_str = parts.next().unwrap_or_default();
            if serial.is_empty() {
                continue;
            }
            let state = match state_str {
                "device" => DeviceState::Online,
                "offline" => DeviceState::Offline,
                "unauthorized" => DeviceState::Unauthorized,
                _ => DeviceState::Unknown,
            };
            let model = parts
                .find_map(|part| part.strip_prefix("model:"))
                .map(|m| m.replace('_', " "));
            devices.push(Device {
                is_emulator: is_emulator_serial(&serial),
                serial,
                state,
                model,
            });
        }
        Ok(devices)
    }
}

const SYSTEM_CACERTS: &str = "/system/etc/security/cacerts";
const APEX_CACERTS: &str = "/apex/com.android.conscrypt/cacerts";

pub struct AdbDevice<'a> {
    runner: &'a dyn CommandRunner,
    pub serial: String,
    su: bool,
}

pub fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

impl<'a> AdbDevice<'a> {
    pub fn new(runner: &'a dyn CommandRunner, serial: &str) -> Self {
        AdbDevice {
            runner,
            serial: serial.to_string(),
            su: false,
        }
    }

    pub fn with_su(mut self) -> Self {
        self.su = true;
        self
    }

    fn shell(&self, cmd: &str) -> Result<Output, DeviceError> {
        if self.su {
            return self.plain_shell(&format!("su -c {}", sh_quote(cmd)));
        }
        self.plain_shell(cmd)
    }

    fn plain_shell(&self, cmd: &str) -> Result<Output, DeviceError> {
        self.runner.run(&["-s", &self.serial, "shell", cmd])
    }

    pub fn exec(&self, cmd: &str) -> Result<Output, DeviceError> {
        self.shell(cmd)
    }

    pub fn has_staged_cert(&self, filename: &str) -> Result<bool, DeviceError> {
        let out = self.plain_shell(&format!("ls /data/local/tmp/beholder-ca-stage/{filename}"))?;
        if out.success {
            return Ok(true);
        }
        let combined = format!("{}{}", out.stdout, out.stderr);
        if combined.contains("No such file") {
            return Ok(false);
        }
        Err(DeviceError::Other(format!(
            "cannot check the staged certificate: {}",
            combined.trim()
        )))
    }

    pub fn is_cert_trusted(&self, filename: &str, cert_pem: &str) -> Result<bool, DeviceError> {
        if is_emulator_serial(&self.serial) {
            return self.is_cert_installed(filename, cert_pem);
        }
        if self.shell(&format!("ls {APEX_CACERTS}"))?.success {
            return self.store_matches(APEX_CACERTS, filename, cert_pem);
        }
        self.store_matches(SYSTEM_CACERTS, filename, cert_pem)
    }

    pub fn remove_mounted_cert(&self, filename: &str) -> Result<(), DeviceError> {
        self.shell(&format!("rm -f {SYSTEM_CACERTS}/{filename}"))?;
        self.shell(&format!("nsenter -t 1 -m -- umount {APEX_CACERTS}"))?;
        self.shell(&format!("nsenter -t 1 -m -- umount {SYSTEM_CACERTS}"))?;
        self.ensure_cert_absent(filename)?;
        self.remove_cert_stage()
    }

    pub fn ensure_cert_absent(&self, filename: &str) -> Result<(), DeviceError> {
        for dir in [SYSTEM_CACERTS, APEX_CACERTS] {
            let out = self.shell(&format!("ls {dir}/{filename}"))?;
            if out.success {
                return Err(DeviceError::Other(format!(
                    "certificate is still present in {dir}; reboot the phone to drop it"
                )));
            }
            let combined = format!("{}{}", out.stdout, out.stderr);
            if !combined.contains("No such file") {
                return Err(DeviceError::Other(format!(
                    "cannot verify that the certificate was removed from {dir}: {}",
                    combined.trim()
                )));
            }
        }
        Ok(())
    }

    pub fn remove_cert_stage(&self) -> Result<(), DeviceError> {
        self.shell_ok("rm -rf /data/local/tmp/beholder-ca-stage")?;
        Ok(())
    }

    pub fn boot_completed(&self) -> Result<bool, DeviceError> {
        let out = self.shell("getprop sys.boot_completed")?;
        Ok(out.stdout.trim() == "1")
    }

    pub fn root(&self) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "root"])?;
        let combined = format!("{}{}", out.stdout, out.stderr).to_lowercase();
        let already = combined.contains("already running as root");
        let restarting = combined.contains("restarting adbd as root");
        if out.success || already || restarting {
            self.runner.run(&["-s", &self.serial, "wait-for-device"])?;
            return Ok(());
        }
        let hint = if combined.contains("production builds") || combined.trim().is_empty() {
            " (Google Play images refuse root — use a Google APIs or AOSP image)"
        } else {
            ""
        };
        Err(DeviceError::Other(format!(
            "adb root failed: {} {}{}",
            out.stdout.trim(),
            out.stderr.trim(),
            hint
        )))
    }

    pub fn remount(&self) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "remount"])?;
        if out.success {
            return Ok(());
        }
        Err(DeviceError::Other(format!(
            "adb remount failed: {}{}",
            out.stdout.trim(),
            out.stderr.trim()
        )))
    }

    fn adb_ok(&self, args: &[&str]) -> Result<Output, DeviceError> {
        let mut full = vec!["-s", self.serial.as_str()];
        full.extend_from_slice(args);
        let out = self.runner.run(&full)?;
        if !out.success {
            return Err(DeviceError::Other(format!(
                "adb {} failed: {}{}",
                args.join(" "),
                out.stdout.trim(),
                out.stderr.trim()
            )));
        }
        Ok(out)
    }

    pub fn reverse(&self, port: u16) -> Result<(), DeviceError> {
        let spec = format!("tcp:{port}");
        self.adb_ok(&["reverse", &spec, &spec])?;
        Ok(())
    }

    pub fn remove_reverse(&self, port: u16) -> Result<(), DeviceError> {
        let spec = format!("tcp:{port}");
        self.adb_ok(&["reverse", "--remove", &spec])?;
        Ok(())
    }

    pub fn has_reverse(&self, port: u16) -> Result<bool, DeviceError> {
        let spec = format!("tcp:{port}");
        let out = self.adb_ok(&["reverse", "--list"])?;
        Ok(out.stdout.lines().any(|line| {
            let mut tokens = line.split_whitespace().rev();
            tokens.next() == Some(spec.as_str()) && tokens.next() == Some(spec.as_str())
        }))
    }

    pub fn push_user_ca(&self, cert_pem: &str) -> Result<(), DeviceError> {
        let tmp = std::env::temp_dir().join("beholder-ca.crt");
        std::fs::write(&tmp, cert_pem)
            .map_err(|e| DeviceError::Other(format!("write temp cert: {e}")))?;
        let src = tmp.to_string_lossy().to_string();
        self.adb_ok(&["push", &src, "/sdcard/Download/beholder-ca.crt"])?;
        Ok(())
    }

    pub fn open_security_settings(&self) -> Result<(), DeviceError> {
        self.shell_ok("am start -a android.settings.SECURITY_SETTINGS")?;
        Ok(())
    }

    fn shell_ok(&self, cmd: &str) -> Result<Output, DeviceError> {
        let out = self.shell(cmd)?;
        if !out.success {
            return Err(DeviceError::Other(format!(
                "shell '{}' failed: {}{}",
                cmd,
                out.stdout.trim(),
                out.stderr.trim()
            )));
        }
        Ok(out)
    }

    fn stage_certs(&self, cert_pem: &str, filename: &str) -> Result<(), DeviceError> {
        let tmp = std::env::temp_dir().join(format!("beholder-{}", filename));
        std::fs::write(&tmp, cert_pem)
            .map_err(|e| DeviceError::Other(format!("write temp cert: {e}")))?;
        let src = tmp.to_string_lossy().to_string();
        let out = self.plain_shell("ls /data/local/tmp/beholder-ca-stage")?;
        if !out.success || out.stdout.trim().is_empty() {
            let created = self.plain_shell("mkdir -p /data/local/tmp/beholder-ca-stage")?;
            if !created.success {
                return Err(DeviceError::Other(format!(
                    "shell 'mkdir -p /data/local/tmp/beholder-ca-stage' failed: {}{}",
                    created.stdout.trim(),
                    created.stderr.trim()
                )));
            }
            let _ = self.plain_shell(
                "cp /system/etc/security/cacerts/* /data/local/tmp/beholder-ca-stage/ 2>/dev/null",
            );
        }
        let push = self.runner.run(&[
            "-s",
            &self.serial,
            "push",
            &src,
            &format!("/data/local/tmp/beholder-ca-stage/{}", filename),
        ])?;
        if !push.success {
            return Err(DeviceError::CommandFailed {
                program: "adb push".into(),
                args: vec![src],
                stderr: push.stderr,
            });
        }
        Ok(())
    }

    fn store_matches(
        &self,
        dir: &str,
        filename: &str,
        cert_pem: &str,
    ) -> Result<bool, DeviceError> {
        let out = self.shell(&format!("cat {dir}/{filename}"))?;
        if !out.success {
            return Ok(false);
        }
        let normalize = |pem: &str| -> String {
            pem.lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with("-----"))
                .collect::<Vec<_>>()
                .join("")
        };
        Ok(normalize(&out.stdout) == normalize(cert_pem))
    }

    fn apex_store_has(&self, filename: &str, cert_pem: &str) -> Result<bool, DeviceError> {
        if !self.shell(&format!("ls {APEX_CACERTS}"))?.success {
            return Ok(true);
        }
        self.store_matches(APEX_CACERTS, filename, cert_pem)
    }

    fn try_direct_push(&self, filename: &str) -> bool {
        self.shell(&format!(
            "cp /data/local/tmp/beholder-ca-stage/{filename} /system/etc/security/cacerts/{filename} && chmod 644 /system/etc/security/cacerts/{filename}"
        ))
        .map(|o| o.success)
        .unwrap_or(false)
    }

    fn try_tmpfs_install(&self) -> Result<(), DeviceError> {
        let mount =
            self.shell("nsenter -t 1 -m -- mount -t tmpfs tmpfs /system/etc/security/cacerts");
        if let Ok(o) = &mount {
            if !o.success && !format!("{}{}", o.stdout, o.stderr).contains("mount point") {
                return Err(DeviceError::Other(format!(
                    "tmpfs mount failed: {}{}",
                    o.stdout.trim(),
                    o.stderr.trim()
                )));
            }
        }
        self.shell_ok("cp /data/local/tmp/beholder-ca-stage/* /system/etc/security/cacerts/")?;
        self.shell_ok("chmod 644 /system/etc/security/cacerts/*")?;
        self.shell_ok("chown root:root /system/etc/security/cacerts/*")?;
        let _ = self.shell(
            "chcon u:object_r:system_security_cacerts_file:s0 /system/etc/security/cacerts/*",
        );
        let _ = self.shell(
            "nsenter -t 1 -m -- mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts",
        );
        Ok(())
    }

    fn propagate_to_zygote(&self) {
        for zygote in ["zygote64", "zygote"] {
            let Ok(out) = self.shell(&format!("pidof {zygote}")) else {
                continue;
            };
            let pid = out.stdout.trim().split_whitespace().next().unwrap_or("");
            if pid.is_empty() {
                continue;
            }
            let _ = self.shell(&format!(
                "nsenter -t {pid} -m -- mount --bind /proc/1/root/system/etc/security/cacerts /system/etc/security/cacerts"
            ));
            let _ = self.shell(&format!(
                "nsenter -t {pid} -m -- mount --bind /system/etc/security/cacerts /apex/com.android.conscrypt/cacerts"
            ));
        }
    }
}

impl<'a> CertificateInstaller for AdbDevice<'a> {
    fn install_system_cert(&self, filename: &str, pem: &str) -> Result<(), DeviceError> {
        self.stage_certs(pem, filename)?;
        let emulator = is_emulator_serial(&self.serial);
        if emulator && self.try_direct_push(filename) {
            return Ok(());
        }
        self.try_tmpfs_install()?;
        self.propagate_to_zygote();
        if !self.is_cert_installed(filename, pem)? {
            return Err(DeviceError::Other(
                "certificate not present in system store after install".into(),
            ));
        }
        if !emulator && !self.apex_store_has(filename, pem)? {
            return Err(DeviceError::Other(
                "certificate not present in the apex store after install".into(),
            ));
        }
        Ok(())
    }

    fn is_cert_installed(&self, filename: &str, cert_pem: &str) -> Result<bool, DeviceError> {
        if self.store_matches(SYSTEM_CACERTS, filename, cert_pem)? {
            return Ok(true);
        }
        Ok(self
            .store_matches(APEX_CACERTS, filename, cert_pem)
            .unwrap_or(false))
    }

    fn uninstall_cert(&self, filename: &str) -> Result<(), DeviceError> {
        let _ = self.shell(&format!("rm -f /system/etc/security/cacerts/{}", filename));
        let _ = self.shell("nsenter -t 1 -m -- umount /apex/com.android.conscrypt/cacerts");
        let _ = self.shell("nsenter -t 1 -m -- umount /system/etc/security/cacerts");
        let _ = self.shell("rm -rf /data/local/tmp/beholder-ca-stage");
        Ok(())
    }
}

impl<'a> ApkInstaller for AdbDevice<'a> {
    fn install_apk(&self, path: &str) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "install", "-r", path])?;
        if out.success {
            return Ok(());
        }
        Err(DeviceError::Other(format!(
            "adb install failed: {}{}",
            out.stdout.trim(),
            out.stderr.trim()
        )))
    }

    fn uninstall(&self, package: &str) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "uninstall", package])?;
        if out.success {
            return Ok(());
        }
        Err(DeviceError::Other(format!(
            "adb uninstall failed: {}{}",
            out.stdout.trim(),
            out.stderr.trim()
        )))
    }
}

impl<'a> ProxyConfigurator for AdbDevice<'a> {
    fn set_proxy(&self, host: &str, port: u16) -> Result<(), DeviceError> {
        self.shell_ok(&format!("settings put global http_proxy {}:{}", host, port))?;
        Ok(())
    }

    fn clear_proxy(&self) -> Result<(), DeviceError> {
        self.shell_ok("settings put global http_proxy :0")?;
        self.shell_ok("settings delete global global_http_proxy_host")?;
        self.shell_ok("settings delete global global_http_proxy_port")?;
        self.shell_ok("settings delete global global_http_proxy_exclusion_list")?;
        Ok(())
    }

    fn current_proxy(&self) -> Result<Option<String>, DeviceError> {
        let out = self.shell("settings get global http_proxy")?;
        let v = out.stdout.trim();
        if v.is_empty() || v == "null" || v == ":0" {
            return Ok(None);
        }
        Ok(Some(v.to_string()))
    }

    fn restore_proxy(&self, previous: Option<&str>) -> Result<(), DeviceError> {
        let safe = |value: &str| {
            !value.is_empty()
                && value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-_:[]".contains(c))
        };
        match previous.filter(|value| safe(value)) {
            Some(value) => {
                self.shell_ok(&format!("settings put global http_proxy {value}"))?;
                Ok(())
            }
            None => self.clear_proxy(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_apk_runs_adb_install_replace() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("Success");
        let device = AdbDevice::new(&runner, "emulator-5554");
        ApkInstaller::install_apk(&device, "/tmp/advisor.apk").unwrap();
        assert_eq!(
            runner.calls.lock().unwrap()[0],
            vec!["-s", "emulator-5554", "install", "-r", "/tmp/advisor.apk"]
        );
    }

    #[test]
    fn install_apk_failure_includes_raw_output() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("INSTALL_FAILED_VERSION_DOWNGRADE");
        let device = AdbDevice::new(&runner, "emulator-5554");
        let err = ApkInstaller::install_apk(&device, "/tmp/advisor.apk").unwrap_err();
        assert!(err.to_string().contains("INSTALL_FAILED_VERSION_DOWNGRADE"));
    }

    #[test]
    fn uninstall_runs_adb_uninstall_with_package() {
        let runner = FakeRunner::new();
        runner.enqueue_ok("Success");
        let device = AdbDevice::new(&runner, "emulator-5554");
        ApkInstaller::uninstall(&device, "com.example.app").unwrap();
        assert_eq!(
            runner.calls.lock().unwrap()[0],
            vec!["-s", "emulator-5554", "uninstall", "com.example.app"]
        );
    }

    #[test]
    fn uninstall_failure_includes_raw_output() {
        let runner = FakeRunner::new();
        runner.enqueue_fail("DELETE_FAILED_INTERNAL_ERROR");
        let device = AdbDevice::new(&runner, "emulator-5554");
        let err = ApkInstaller::uninstall(&device, "com.example.app").unwrap_err();
        assert!(err.to_string().contains("DELETE_FAILED_INTERNAL_ERROR"));
    }
}
