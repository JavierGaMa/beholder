pub mod avd;
pub mod runner;
pub mod types;

pub use avd::{
    accept_licenses, create_avd_with_stdin, enrich_avds_from_config, launch_emulator_detached,
    parse_avdmanager_list, parse_device_profiles, parse_sdkmanager_images, AvdManager,
    FakeSdkRunner, RealSdkRunner, SdkTool, SdkToolRunner,
};
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

    pub fn root(&self) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "root"])?;
        if !out.success {
            return Err(DeviceError::Other(
                "adbd cannot run as root: use a Google APIs or AOSP emulator image (Google Play images refuse root)".into(),
            ));
        }
        self.runner.run(&["-s", &self.serial, "wait-for-device"])?;
        Ok(())
    }

    pub fn remount(&self) -> Result<(), DeviceError> {
        let out = self.runner.run(&["-s", &self.serial, "remount"])?;
        if out.success {
            return Ok(());
        }
        self.runner.run(&["-s", &self.serial, "disable-verity"])?;
        self.runner.run(&["-s", &self.serial, "reboot"])?;
        self.runner.run(&["-s", &self.serial, "wait-for-device"])?;
        self.runner.run(&["-s", &self.serial, "root"])?;
        let retry = self.runner.run(&["-s", &self.serial, "remount"])?;
        if !retry.success {
            return Err(DeviceError::Other(
                "remount failed after disable-verity + reboot".into(),
            ));
        }
        Ok(())
    }
}

impl<'a> CertificateInstaller for AdbDevice<'a> {
    fn install_system_cert(&self, filename: &str, pem: &str) -> Result<(), DeviceError> {
        let tmp = std::env::temp_dir().join(format!("beholder-{}", filename));
        std::fs::write(&tmp, pem)
            .map_err(|e| DeviceError::Other(format!("write temp cert: {e}")))?;
        let src = tmp.to_string_lossy().to_string();
        let dst = format!("/system/etc/security/cacerts/{}", filename);
        let out = self.runner.run(&["-s", &self.serial, "push", &src, &dst])?;
        if !out.success {
            return Err(DeviceError::CommandFailed {
                program: "adb push".into(),
                args: vec![src, dst],
                stderr: out.stderr,
            });
        }
        self.shell(&format!("chmod 644 {}", dst))?;
        Ok(())
    }

    fn is_cert_installed(&self, filename: &str) -> Result<bool, DeviceError> {
        let out = self.shell(&format!("ls /system/etc/security/cacerts/{}", filename))?;
        Ok(out.success)
    }

    fn uninstall_cert(&self, filename: &str) -> Result<(), DeviceError> {
        self.shell(&format!("rm -f /system/etc/security/cacerts/{}", filename))?;
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
