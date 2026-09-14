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
        cmd.args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| DeviceError::Other(e.to_string()))?;
        let stderr_handle = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                let mut raw = Vec::new();
                let _ = err.read_to_end(&mut raw);
                String::from_utf8_lossy(&raw).into_owned()
            })
        });
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
        if let Some(handle) = stderr_handle {
            stderr_all = handle.join().unwrap_or_default();
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
    let mut strings: Vec<String> = Vec::new();
    for line in plist.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("<string>").and_then(|s| s.strip_suffix("</string>")) {
            strings.push(v.to_string());
        }
    }
    strings
        .iter()
        .find(|p| p.starts_with('/') && (p.contains("Android Studio") || p.contains("android-studio")))
        .or_else(|| strings.iter().find(|p| p.starts_with('/')))
        .map(PathBuf::from)
}

pub fn install_cmdline_tools(
    runner: &dyn HostRunner,
    sdk_root: &Path,
    cache_dir: &Path,
    on_line: &mut dyn FnMut(&str),
) -> Result<(), DeviceError> {
    let unpack = cache_dir.join("ct-unpack");
    let _ = std::fs::remove_dir_all(&unpack);
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
    let xml =
        xml.ok_or_else(|| DeviceError::Other("could not fetch the sdk repository index".into()))?;
    let url = resolve_cmdline_tools_url(&xml)
        .ok_or_else(|| DeviceError::Other("could not resolve the cmdline-tools zip url".into()))?;
    let zip = cache_dir.join("cmdline-tools.zip");
    let zip_str = zip.display().to_string();
    on_line("downloading command-line tools...");
    let (ok, stderr) = runner.run_streaming(
        "curl",
        &["-fL", "--progress-bar", "-o", &zip_str, &url],
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
    on_line("unpacking command-line tools...");
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
    std::fs::create_dir_all(sdk_root.join("cmdline-tools"))
        .map_err(|e| DeviceError::Other(e.to_string()))?;
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
    fn resolves_highest_cmdline_tools_build() {
        let xml = "x commandlinetools-mac-11076708_latest.zip y commandlinetools-mac-15641748_latest.zip commandlinetools-mac-9477386_latest.zip";
        assert_eq!(
            resolve_cmdline_tools_url(xml).unwrap(),
            "https://dl.google.com/android/repository/commandlinetools-mac-15641748_latest.zip"
        );
    }

    #[test]
    fn resolves_studio_dmg_by_arch() {
        let page = "<a href=\"https://edgedl.me.gvt1.com/android/studio/install/2026.1.4.7/android-studio-quail4-mac_arm.dmg\">arm</a><a href=\"https://edgedl.me.gvt1.com/android/studio/install/2026.1.4.7/android-studio-quail4-mac.dmg\">intel</a>";
        assert!(resolve_studio_dmg_url(page, true).unwrap().ends_with("mac_arm.dmg"));
        assert!(resolve_studio_dmg_url(page, false).unwrap().ends_with("quail4-mac.dmg"));
    }

    #[test]
    fn install_studio_skips_when_present() {
        let root = temp_root("studio-skip");
        let studio = root.join("Android Studio.app");
        std::fs::create_dir_all(&studio).unwrap();
        let runner = FakeHostRunner::new();
        install_studio(&runner, &studio, &root, &mut |_| {}).unwrap();
        assert!(runner.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn install_cmdline_tools_lays_out_latest() {
        let root = temp_root("cmdline");
        let sdk = root.join("sdk");
        std::fs::create_dir_all(&sdk).unwrap();
        let unpack = root.join("unpack");
        touch(&unpack.join("cmdline-tools/bin/sdkmanager"));
        let xml = "commandlinetools-mac-15641748_latest.zip";
        let runner = FakeHostRunner::new();
        runner.enqueue_ok(xml);
        runner.enqueue_ok("");
        runner.enqueue_ok("");
        install_cmdline_tools_into(&runner, &sdk, &root, &unpack, &mut |_| {}).unwrap();
        assert!(sdk.join("cmdline-tools/latest/bin/sdkmanager").exists());
        let calls = runner.calls.lock().unwrap();
        assert!(calls.iter().any(|(p, _)| p == "curl"));
        assert!(calls.iter().any(|(p, _)| p == "unzip"));
    }

    #[test]
    fn write_shell_env_appends_once() {
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
        fn run(
            &self,
            program: &str,
            args: &[&str],
            _envs: &[(&str, &str)],
        ) -> Result<Output, DeviceError> {
            self.calls.lock().unwrap().push((
                program.into(),
                args.iter().map(|s| s.to_string()).collect(),
            ));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(DeviceError::Other("no scripted response".into())))
        }
    }
}
