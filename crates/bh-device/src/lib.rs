pub mod avd;
pub mod doctor;
pub mod runner;
pub mod types;

pub use avd::{
    accept_licenses, create_avd_with_stdin, enrich_avds_from_config, launch_emulator_detached,
    parse_avdmanager_list, parse_device_profiles, parse_sdkmanager_images, AvdManager,
    FakeSdkRunner, RealSdkRunner, SdkTool, SdkToolRunner,
};
pub use doctor::{apply_basic_fix, run_checks, CheckStatus, DoctorCheck, FixId};
pub use runner::{CommandRunner, DeviceError, FakeRunner, Output, RealRunner};
pub use types::{AvdInfo, Device, DeviceState, SystemImage};

pub trait DeviceScanner {
    fn list(&self) -> Result<Vec<Device>, DeviceError>;
}

pub trait CertificateInstaller {
    fn install_system_cert(&self, filename: &str, pem: &str) -> Result<(), DeviceError>;
    fn is_cert_installed(&self, filename: &str) -> Result<bool, DeviceError>;
    fn uninstall_cert(&self, filename: &str) -> Result<(), DeviceError>;
}

pub trait ProxyConfigurator {
    fn set_proxy(&self, host: &str, port: u16) -> Result<(), DeviceError>;
    fn clear_proxy(&self) -> Result<(), DeviceError>;
    fn current_proxy(&self) -> Result<Option<String>, DeviceError>;
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
        let out = self.runner.run(&["devices"])?;
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
            devices.push(Device {
                is_emulator: serial.starts_with("emulator-"),
                serial,
                state,
            });
        }
        Ok(devices)
    }
}

pub struct AdbDevice<'a> {
    runner: &'a dyn CommandRunner,
    pub serial: String,
}

impl<'a> AdbDevice<'a> {
    pub fn new(runner: &'a dyn CommandRunner, serial: &str) -> Self {
        AdbDevice {
            runner,
            serial: serial.to_string(),
        }
    }

    fn shell(&self, cmd: &str) -> Result<Output, DeviceError> {
        self.runner.run(&["-s", &self.serial, "shell", cmd])
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
        let out = self.runner.run(&[
            "-s",
            &self.serial,
            "shell",
            "ls /data/local/tmp/beholder-ca-stage",
        ])?;
        if !out.success || out.stdout.trim().is_empty() {
            self.shell_ok("mkdir -p /data/local/tmp/beholder-ca-stage")?;
            let _ = self.shell(
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
        }
    }
}

impl<'a> CertificateInstaller for AdbDevice<'a> {
    fn install_system_cert(&self, filename: &str, pem: &str) -> Result<(), DeviceError> {
        self.stage_certs(pem, filename)?;
        if self.try_direct_push(filename) {
            return Ok(());
        }
        self.try_tmpfs_install()?;
        self.propagate_to_zygote();
        if self.is_cert_installed(filename)? {
            Ok(())
        } else {
            Err(DeviceError::Other(
                "certificate not present in system store after install".into(),
            ))
        }
    }

    fn is_cert_installed(&self, filename: &str) -> Result<bool, DeviceError> {
        let out = self.shell(&format!("ls /system/etc/security/cacerts/{}", filename))?;
        Ok(out.success)
    }

    fn uninstall_cert(&self, filename: &str) -> Result<(), DeviceError> {
        let _ = self.shell(&format!("rm -f /system/etc/security/cacerts/{}", filename));
        let _ = self.shell("nsenter -t 1 -m -- umount /system/etc/security/cacerts");
        let _ = self.shell("rm -rf /data/local/tmp/beholder-ca-stage");
        Ok(())
    }
}

impl<'a> ProxyConfigurator for AdbDevice<'a> {
    fn set_proxy(&self, host: &str, port: u16) -> Result<(), DeviceError> {
        let out = self.shell(&format!("settings put global http_proxy {}:{}", host, port))?;
        if !out.success {
            return Err(DeviceError::Other("failed to set http_proxy".into()));
        }
        Ok(())
    }

    fn clear_proxy(&self) -> Result<(), DeviceError> {
        self.shell("settings put global http_proxy :0")?;
        Ok(())
    }

    fn current_proxy(&self) -> Result<Option<String>, DeviceError> {
        let out = self.shell("settings get global http_proxy")?;
        let v = out.stdout.trim().to_string();
        if v.is_empty() || v == ":0" || v == "null" {
            return Ok(None);
        }
        Ok(Some(v))
    }
}
