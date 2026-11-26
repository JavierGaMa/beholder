use crate::probe::COMPANION_PACKAGE;
use crate::runner::{CommandRunner, DeviceError, Output};
use crate::{is_emulator_serial, AdbDevice};
use sha2::{Digest, Sha256};
use std::time::Duration;

const AUTHORITY: &str = "content://dev.beholder.app.control";
const ACTION_START: &str = "dev.beholder.app.DESKTOP_START";
const ACTION_STOP: &str = "dev.beholder.app.DESKTOP_STOP";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionStatus {
    pub version: String,
    pub capture: String,
    pub package: String,
    pub port: u16,
    pub error: String,
}

pub fn supports_desktop(version: &str) -> bool {
    let mut parts = version.split('.').map(|part| part.parse::<u32>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor)) => (major, minor) >= (0, 3),
        _ => false,
    }
}

pub fn use_companion(serial: &str, version: Option<&str>, package: Option<&str>) -> bool {
    !is_emulator_serial(serial) && package.is_some() && version.is_some_and(supports_desktop)
}

fn raw(out: &Output) -> String {
    format!("{}{}", out.stdout.trim(), out.stderr.trim())
}

fn parse_status(row: &str) -> Option<CompanionStatus> {
    let rest = row.trim().split_once("version=")?.1;
    let (version, rest) = rest.split_once(", capture=")?;
    let (capture, rest) = rest.split_once(", package=")?;
    let (package, rest) = rest.split_once(", port=")?;
    let (port, error) = rest.split_once(", error=")?;
    Some(CompanionStatus {
        version: version.into(),
        capture: capture.into(),
        package: package.into(),
        port: port.parse().ok()?,
        error: error.into(),
    })
}

fn query(runner: &dyn CommandRunner, serial: &str, path: &str) -> Result<Output, DeviceError> {
    AdbDevice::new(runner, serial).exec(&format!("content query --uri {AUTHORITY}/{path}"))
}

pub fn installed_version(
    runner: &dyn CommandRunner,
    serial: &str,
) -> Result<Option<String>, DeviceError> {
    let out = AdbDevice::new(runner, serial).exec(&format!(
        "dumpsys package {COMPANION_PACKAGE} | grep versionName"
    ))?;
    Ok(out
        .stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("versionName="))
        .map(str::to_string))
}

pub fn status(runner: &dyn CommandRunner, serial: &str) -> Result<CompanionStatus, DeviceError> {
    let out = query(runner, serial, "status")?;
    parse_status(&out.stdout).ok_or_else(|| {
        DeviceError::Other(format!("cannot read the companion status: {}", raw(&out)))
    })
}

pub fn ca_installed(
    runner: &dyn CommandRunner,
    serial: &str,
    cert_pem: &str,
) -> Result<bool, DeviceError> {
    let certificate = pem::parse(cert_pem)
        .map_err(|e| DeviceError::Other(format!("invalid certificate: {e}")))?;
    let fingerprint: String = Sha256::digest(certificate.contents())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let out = query(runner, serial, &format!("ca/{fingerprint}"))?;
    match out.stdout.trim().rsplit_once("installed=") {
        Some((_, "1")) => Ok(true),
        Some((_, "0")) => Ok(false),
        _ => Err(DeviceError::Other(format!(
            "cannot read the certificate state from the companion: {}",
            raw(&out)
        ))),
    }
}

fn send(
    runner: &dyn CommandRunner,
    serial: &str,
    flags: &str,
    action: &str,
) -> Result<(), DeviceError> {
    let out = AdbDevice::new(runner, serial).exec(&format!(
        "am start{flags} -n {COMPANION_PACKAGE}/.ControlActivity -a {action}"
    ))?;
    if !out.success || raw(&out).contains("Error:") {
        return Err(DeviceError::Other(format!(
            "cannot reach the companion: {}",
            raw(&out)
        )));
    }
    Ok(())
}

pub fn start(
    runner: &dyn CommandRunner,
    serial: &str,
    package: &str,
    port: u16,
    attempts: u32,
    interval: Duration,
) -> Result<(), DeviceError> {
    if package.is_empty()
        || !package
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_'))
    {
        return Err(DeviceError::Other(format!("invalid package name: {package}")));
    }
    let _ = AdbDevice::new(runner, serial).exec(&format!(
        "appops set {COMPANION_PACKAGE} ACTIVATE_VPN allow"
    ));
    let previous_error = status(runner, serial)?.error;
    send(
        runner,
        serial,
        " --activity-multiple-task",
        &format!("{ACTION_START} --es package {package} --ei port {port}"),
    )?;
    let mut last_error = String::new();
    for _ in 0..attempts {
        std::thread::sleep(interval);
        let current = status(runner, serial)?;
        if current.capture == "desktop" && current.package == package && current.port == port {
            return Ok(());
        }
        if !current.error.is_empty() && current.error != previous_error {
            return Err(DeviceError::Other(format!(
                "the companion could not start the capture: {}",
                current.error
            )));
        }
        last_error = current.error;
    }
    Err(DeviceError::Other(if last_error.is_empty() {
        "the companion did not start the capture. Unlock the phone, accept the VPN request, and try again".into()
    } else {
        format!("the companion could not start the capture: {last_error}")
    }))
}

pub fn stop(runner: &dyn CommandRunner, serial: &str) -> Result<(), DeviceError> {
    send(runner, serial, "", ACTION_STOP)
}
