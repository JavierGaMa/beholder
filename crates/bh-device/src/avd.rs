use crate::runner::{DeviceError, Output};
use crate::types::{AvdInfo, SystemImage};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SdkTool {
    Emulator,
    AvdManager,
    SdkManager,
}

pub trait SdkToolRunner: Send + Sync {
    fn run(&self, tool: SdkTool, args: &[&str]) -> Result<Output, DeviceError>;
}

pub struct RealSdkRunner {
    sdk_root: PathBuf,
    emulator: PathBuf,
    avdmanager: PathBuf,
    sdkmanager: PathBuf,
}

fn home_sdk_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let p = PathBuf::from(home).join("Library/Android/sdk");
    p.exists().then_some(p)
}

impl RealSdkRunner {
    pub fn discover() -> Result<Self, DeviceError> {
        let root = [
            std::env::var("ANDROID_HOME").ok().map(PathBuf::from),
            std::env::var("ANDROID_SDK_ROOT").ok().map(PathBuf::from),
            home_sdk_root(),
        ]
        .into_iter()
        .flatten()
        .find(|p| p.is_dir())
        .ok_or_else(|| {
            DeviceError::Other(
                "Android SDK not found: set ANDROID_HOME or install to ~/Library/Android/sdk"
                    .into(),
            )
        })?;

        let cmdline_bins = [
            root.join("cmdline-tools/latest/bin"),
            root.join("cmdline-tools/bin"),
            root.join("tools/bin"),
        ];
        let find_bin = |bins: &[PathBuf], name: &str| -> Option<PathBuf> {
            bins.iter().map(|b| b.join(name)).find(|p| p.exists())
        };

        let avdmanager = find_bin(&cmdline_bins, "avdmanager").ok_or_else(|| {
            DeviceError::Other(
                "avdmanager not found: install cmdline-tools via Android Studio SDK Manager".into(),
            )
        })?;
        let sdkmanager = find_bin(&cmdline_bins, "sdkmanager").ok_or_else(|| {
            DeviceError::Other(
                "sdkmanager not found: install cmdline-tools via Android Studio SDK Manager".into(),
            )
        })?;
        let emulator = root.join("emulator/emulator");
        if !emulator.exists() {
            return Err(DeviceError::Other(
                "emulator binary not found in SDK".into(),
            ));
        }
        Ok(RealSdkRunner {
            sdk_root: root,
            emulator,
            avdmanager,
            sdkmanager,
        })
    }

    pub fn sdk_root(&self) -> &Path {
        &self.sdk_root
    }

    pub fn tool_path(&self, tool: SdkTool) -> &PathBuf {
        match tool {
            SdkTool::Emulator => &self.emulator,
            SdkTool::AvdManager => &self.avdmanager,
            SdkTool::SdkManager => &self.sdkmanager,
        }
    }
}

impl SdkToolRunner for RealSdkRunner {
    fn run(&self, tool: SdkTool, args: &[&str]) -> Result<Output, DeviceError> {
        let out = Command::new(self.tool_path(tool))
            .args(args)
            .output()
            .map_err(|e| DeviceError::Other(e.to_string()))?;
        Ok(Output {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            success: out.status.success(),
        })
    }
}

pub struct FakeSdkRunner {
    pub calls: std::sync::Mutex<Vec<(SdkTool, Vec<String>)>>,
    pub responses: std::sync::Mutex<std::collections::VecDeque<Result<Output, DeviceError>>>,
}

impl FakeSdkRunner {
    pub fn new() -> Self {
        FakeSdkRunner {
            calls: std::sync::Mutex::new(vec![]),
            responses: std::sync::Mutex::new(std::collections::VecDeque::new()),
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

impl Default for FakeSdkRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl SdkToolRunner for FakeSdkRunner {
    fn run(&self, tool: SdkTool, args: &[&str]) -> Result<Output, DeviceError> {
        self.calls
            .lock()
            .unwrap()
            .push((tool, args.iter().map(|s| s.to_string()).collect()));
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(DeviceError::Other("no scripted response".into())))
    }
}

fn is_rootable_tag(tag: &str) -> bool {
    tag == "google_apis" || tag == "default"
}

pub fn parse_avdmanager_list(stdout: &str) -> Vec<AvdInfo> {
    let mut avds = Vec::new();
    let mut current: Option<AvdInfo> = None;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("Name: ") {
            if let Some(avd) = current.take() {
                avds.push(avd);
            }
            current = Some(AvdInfo {
                name: name.trim().to_string(),
                device: None,
                image_tag: None,
                abi: None,
                api_level: None,
                beholder_ready: false,
                running: false,
                serial: None,
                path: None,
            });
        } else if let Some(avd) = current.as_mut() {
            if let Some(dev) = trimmed.strip_prefix("Device: ") {
                avd.device = dev.split_whitespace().next().map(|s| s.to_string());
            } else if let Some(p) = trimmed.strip_prefix("Path: ") {
                avd.path = Some(PathBuf::from(p.trim()));
            } else if let Some(idx) = trimmed.find("Tag/ABI: ") {
                let tagabi = trimmed[idx + 9..].trim();
                let mut parts = tagabi.splitn(2, '/');
                let tag = parts.next().unwrap_or_default().trim().to_string();
                let abi = parts.next().unwrap_or_default().trim().to_string();
                avd.beholder_ready = is_rootable_tag(&tag);
                avd.image_tag = Some(tag);
                if !abi.is_empty() {
                    avd.abi = Some(abi);
                }
            } else if let Some(target) = trimmed.strip_prefix("Target: ") {
                if let Some(idx) = target.find("API ") {
                    let digits: String = target[idx + 4..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    avd.api_level = digits.parse().ok();
                }
            }
        }
    }
    if let Some(avd) = current {
        avds.push(avd);
    }
    avds
}

pub fn enrich_avds_from_config(avds: &mut [AvdInfo]) {
    for avd in avds.iter_mut() {
        let Some(path) = &avd.path else { continue };
        let Ok(content) = std::fs::read_to_string(path.join("config.ini")) else {
            continue;
        };
        for line in content.lines() {
            if let Some(v) = line.strip_prefix("image.sysdir.1=") {
                let v = v.trim().trim_end_matches('/');
                let parts: Vec<&str> = v.split('/').collect();
                if parts.len() == 4 && parts[0] == "system-images" {
                    let tag = parts[2].to_string();
                    avd.image_tag = Some(tag.clone());
                    avd.abi = Some(parts[3].to_string());
                    avd.api_level = parts[1]
                        .strip_prefix("android-")
                        .and_then(|s| s.split('.').next())
                        .and_then(|s| s.parse().ok());
                    avd.beholder_ready = is_rootable_tag(&tag);
                }
            } else if let Some(v) = line.strip_prefix("hw.device.name=") {
                avd.device = Some(v.trim().to_string());
            }
        }
    }
}

pub fn parse_sdkmanager_images(stdout: &str) -> Vec<SystemImage> {
    let mut installed_section = false;
    let mut images: Vec<SystemImage> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Installed packages") {
            installed_section = true;
            continue;
        }
        if trimmed.starts_with("Available Packages") {
            installed_section = false;
            continue;
        }
        if !trimmed.starts_with("system-images;") {
            continue;
        }
        let pkg = trimmed
            .split('|')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        let parts: Vec<&str> = pkg.split(';').collect();
        if parts.len() != 4 {
            continue;
        }
        let tag = parts[2].to_string();
        let abi = parts[3].to_string();
        if !is_rootable_tag(&tag) || abi != "arm64-v8a" {
            continue;
        }
        let api: u32 = match parts[1]
            .strip_prefix("android-")
            .and_then(|s| s.split('.').next().unwrap_or(s).parse().ok())
        {
            Some(v) => v,
            None => continue,
        };
        if let Some(existing) = images.iter_mut().find(|i| i.pkg == pkg) {
            if installed_section {
                existing.installed = true;
            }
            continue;
        }
        images.push(SystemImage {
            pkg,
            api,
            tag,
            abi,
            installed: installed_section,
        });
    }
    images.sort_by(|a, b| b.api.cmp(&a.api).then(a.pkg.cmp(&b.pkg)));
    images
}

pub fn parse_device_profiles(stdout: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("id: ") else {
            continue;
        };
        let id = if let Some(qstart) = rest.find('"') {
            let after = &rest[qstart + 1..];
            match after.find('"') {
                Some(end) => &after[..end],
                None => continue,
            }
        } else {
            rest.split("||").next().unwrap_or(rest).trim()
        };
        let id = id.trim();
        if id.starts_with("pixel_") && !ids.contains(&id.to_string()) {
            ids.push(id.to_string());
        }
    }
    ids
}

pub struct AvdManager<'a> {
    runner: &'a dyn SdkToolRunner,
}

impl<'a> AvdManager<'a> {
    pub fn new(runner: &'a dyn SdkToolRunner) -> Self {
        AvdManager { runner }
    }

    pub fn list_avds(&self) -> Result<Vec<AvdInfo>, DeviceError> {
        let out = self.runner.run(SdkTool::AvdManager, &["list", "avd"])?;
        let mut avds = parse_avdmanager_list(&out.stdout);
        enrich_avds_from_config(&mut avds);
        Ok(avds)
    }

    pub fn list_images(&self) -> Result<Vec<SystemImage>, DeviceError> {
        let out = self.runner.run(SdkTool::SdkManager, &["--list"])?;
        Ok(parse_sdkmanager_images(&out.stdout))
    }

    pub fn list_device_profiles(&self) -> Result<Vec<String>, DeviceError> {
        let out = self.runner.run(SdkTool::AvdManager, &["list", "device"])?;
        Ok(parse_device_profiles(&out.stdout))
    }

    pub fn create_avd(
        &self,
        name: &str,
        image_pkg: &str,
        profile: &str,
    ) -> Result<(), DeviceError> {
        let out = self.runner.run(
            SdkTool::AvdManager,
            &[
                "create", "avd", "-n", name, "-k", image_pkg, "-d", profile, "--force",
            ],
        )?;
        if !out.success {
            return Err(DeviceError::CommandFailed {
                program: "avdmanager create avd".into(),
                args: vec![name.into(), image_pkg.into(), profile.into()],
                stderr: out.stderr,
            });
        }
        Ok(())
    }
}

pub fn launch_emulator_detached(runner: &RealSdkRunner, avd_name: &str) -> Result<(), DeviceError> {
    Command::new(runner.tool_path(SdkTool::Emulator))
        .arg("-avd")
        .arg(avd_name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| DeviceError::Other(format!("failed to launch emulator: {e}")))?;
    Ok(())
}

pub fn find_aapt(sdk_root: &Path) -> Option<PathBuf> {
    let bin = if cfg!(windows) { "aapt.exe" } else { "aapt" };
    let mut versions: Vec<(Vec<u32>, PathBuf)> = std::fs::read_dir(sdk_root.join("build-tools"))
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let version = build_tools_version(e.file_name().to_string_lossy().as_ref())?;
            let path = e.path().join(bin);
            path.is_file().then_some((version, path))
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions.into_iter().next().map(|(_, p)| p)
}

fn build_tools_version(name: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = name.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|v| !v.is_empty())
}

pub fn read_apk_package(aapt: &Path, apk: &Path) -> Result<String, DeviceError> {
    let out = Command::new(aapt)
        .arg("dump")
        .arg("badging")
        .arg(apk)
        .output()
        .map_err(|e| DeviceError::Other(format!("aapt dump badging failed: {e}")))?;
    if !out.status.success() {
        return Err(DeviceError::Other(format!(
            "aapt dump badging failed: {}{}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    parse_badging_package(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| {
        DeviceError::Other("aapt badging output did not contain a package name".into())
    })
}

pub fn parse_badging_package(badging: &str) -> Option<String> {
    for line in badging.lines() {
        let Some(rest) = line.trim().strip_prefix("package:") else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix("name='") else {
            continue;
        };
        let end = rest.find('\'')?;
        return Some(rest[..end].to_string());
    }
    None
}

pub fn accept_licenses(sdkmanager: &Path) -> Result<(), DeviceError> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(format!("yes | '{}' --licenses", sdkmanager.display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| DeviceError::Other(e.to_string()))?;
    let _ = child.wait();
    Ok(())
}

pub fn create_avd_with_stdin(
    avdmanager: &Path,
    name: &str,
    image_pkg: &str,
    profile: &str,
) -> Result<(), DeviceError> {
    let mut child = Command::new(avdmanager)
        .args([
            "create", "avd", "-n", name, "-k", image_pkg, "-d", profile, "--force",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| DeviceError::Other(e.to_string()))?;
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"no\n");
    }
    let out = child
        .wait_with_output()
        .map_err(|e| DeviceError::Other(e.to_string()))?;
    if !out.status.success() {
        return Err(DeviceError::CommandFailed {
            program: "avdmanager create avd".into(),
            args: vec![name.into(), image_pkg.into(), profile.into()],
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        });
    }
    Ok(())
}
