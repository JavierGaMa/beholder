use crate::runner::{CommandRunner, DeviceError};
use crate::{is_emulator_serial, AdbDevice};
use serde::Serialize;

pub const COMPANION_PACKAGE: &str = "dev.beholder.app";
pub const SU_GRANT_HINT: &str =
    "su was denied. Allow Shell in the Magisk Superuser tab, then try again.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RootAccess {
    None,
    AdbRoot,
    Su,
    SuDenied,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeviceProbe {
    pub serial: String,
    pub model: String,
    pub android_release: String,
    pub sdk: Option<u32>,
    pub is_emulator: bool,
    pub root: RootAccess,
    pub system_ca_installed: bool,
    pub companion_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Basic,
    UserCa,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TierState {
    Ready,
    Action,
    Locked,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TierStatus {
    pub tier: Tier,
    pub state: TierState,
    pub detail: String,
}

fn read_prop(device: &AdbDevice, prop: &str) -> Result<String, DeviceError> {
    let out = device.shell_ok(&format!("getprop {prop}"))?;
    Ok(out.stdout.trim().to_string())
}

pub fn root_access(runner: &dyn CommandRunner, serial: &str) -> Result<RootAccess, DeviceError> {
    let device = AdbDevice::new(runner, serial);
    if device.shell("id")?.stdout.contains("uid=0") {
        return Ok(RootAccess::AdbRoot);
    }
    let has_su = device.shell("command -v su")?.success;
    if has_su && device.shell("timeout 10 su -c id")?.stdout.contains("uid=0") {
        return Ok(RootAccess::Su);
    }
    if device.shell("getprop ro.debuggable")?.stdout.trim() == "1" {
        return Ok(RootAccess::AdbRoot);
    }
    Ok(if has_su {
        RootAccess::SuDenied
    } else {
        RootAccess::None
    })
}

pub fn probe(
    runner: &dyn CommandRunner,
    serial: &str,
    cert_filename: &str,
    cert_pem: &str,
) -> Result<DeviceProbe, DeviceError> {
    let device = AdbDevice::new(runner, serial);
    let model = read_prop(&device, "ro.product.model")?;
    let android_release = read_prop(&device, "ro.build.version.release")?;
    let sdk = read_prop(&device, "ro.build.version.sdk")?.parse().ok();
    let root = root_access(runner, serial)?;
    let companion_version = device
        .shell(&format!(
            "dumpsys package {COMPANION_PACKAGE} | grep versionName"
        ))?
        .stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("versionName="))
        .map(str::to_string);
    let system_ca_installed = device
        .is_cert_trusted(cert_filename, cert_pem)
        .unwrap_or(false);
    Ok(DeviceProbe {
        serial: serial.to_string(),
        model,
        android_release,
        sdk,
        is_emulator: is_emulator_serial(serial),
        root,
        system_ca_installed,
        companion_version,
    })
}

pub fn tiers(probe: &DeviceProbe) -> Vec<TierStatus> {
    let status = |tier, state, detail: &str| TierStatus {
        tier,
        state,
        detail: detail.to_string(),
    };
    let basic = status(
        Tier::Basic,
        TierState::Ready,
        "Logcat, shell, APK install, plain HTTP and Metro.",
    );
    let user_ca = if probe.system_ca_installed {
        status(
            Tier::UserCa,
            TierState::Ready,
            "Covered by the system certificate. No changes to your app.",
        )
    } else {
        status(
            Tier::UserCa,
            TierState::Action,
            "Install the certificate in Settings and add the config to your debug build.",
        )
    };
    let full = if probe.system_ca_installed {
        status(
            Tier::Full,
            TierState::Ready,
            "System certificate installed. HTTPS of any app without certificate pinning.",
        )
    } else {
        match probe.root {
            RootAccess::Su | RootAccess::AdbRoot => status(
                Tier::Full,
                TierState::Action,
                "Root detected. Install the Beholder certificate as a system certificate.",
            ),
            RootAccess::SuDenied => status(Tier::Full, TierState::Action, SU_GRANT_HINT),
            RootAccess::None => status(
                Tier::Full,
                TierState::Locked,
                "Needs Magisk root. Unlocks HTTPS of any app without pinning and the database viewer.",
            ),
        }
    };
    vec![basic, user_ca, full]
}
