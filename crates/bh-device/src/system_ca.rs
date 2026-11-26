use crate::probe::{root_access, RootAccess, SU_GRANT_HINT};
use crate::runner::{CommandRunner, DeviceError};
use crate::{is_emulator_serial, AdbDevice, CertificateInstaller};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaOutcome {
    AlreadyInstalled,
    Installed,
    Skipped,
}

fn install_as_adb_root(
    device: &AdbDevice,
    filename: &str,
    pem: &str,
) -> Result<CaOutcome, DeviceError> {
    device.root()?;
    device.install_system_cert(filename, pem)?;
    Ok(CaOutcome::Installed)
}

pub fn ensure_system_ca(
    runner: &dyn CommandRunner,
    serial: &str,
    filename: &str,
    pem: &str,
) -> Result<CaOutcome, DeviceError> {
    let device = AdbDevice::new(runner, serial);
    if device.is_cert_installed(filename, pem)? {
        return Ok(CaOutcome::AlreadyInstalled);
    }
    if is_emulator_serial(serial) {
        return install_as_adb_root(&device, filename, pem);
    }
    match root_access(runner, serial)? {
        RootAccess::AdbRoot => install_as_adb_root(&device, filename, pem),
        RootAccess::Su => {
            device.with_su().install_system_cert(filename, pem)?;
            Ok(CaOutcome::Installed)
        }
        RootAccess::SuDenied => {
            let raw = runner.run(&["-s", serial, "shell", "timeout 10 su -c id"])?;
            Err(DeviceError::Other(format!(
                "{SU_GRANT_HINT}\nadb shell su -c id: {}{}",
                raw.stdout.trim(),
                raw.stderr.trim()
            )))
        }
        RootAccess::None => Ok(CaOutcome::Skipped),
    }
}

pub fn remove_system_ca(
    runner: &dyn CommandRunner,
    serial: &str,
    filename: &str,
) -> Result<(), DeviceError> {
    let device = AdbDevice::new(runner, serial);
    if is_emulator_serial(serial) {
        return device.uninstall_cert(filename);
    }
    if !device.has_staged_cert(filename)? {
        return Ok(());
    }
    match root_access(runner, serial)? {
        RootAccess::Su => device.with_su().uninstall_cert(filename),
        RootAccess::AdbRoot => device.uninstall_cert(filename),
        RootAccess::SuDenied => Err(DeviceError::Other(SU_GRANT_HINT.into())),
        RootAccess::None => Ok(()),
    }
}
