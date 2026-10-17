use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;

use bh_device::{DeviceError, Output};

#[derive(Debug)]
pub struct RnProject {
    pub root: PathBuf,
    pub android_dir: PathBuf,
    pub gradle_file: PathBuf,
    pub flavors: Vec<String>,
    pub build_types: Vec<String>,
    pub application_id: Option<String>,
    pub flavor_ids: Vec<FlavorApplicationId>,
    pub duplicate_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlavorApplicationId {
    pub flavor: String,
    pub suffix: Option<String>,
    pub effective: Option<String>,
}

pub fn detect(root: &Path) -> Result<RnProject, DeviceError> {
    let pkg = root.join("package.json");
    if !pkg.is_file() {
        return Err(DeviceError::Other(
            "no package.json under the given path".into(),
        ));
    }
    let content =
        std::fs::read_to_string(&pkg).map_err(|e| DeviceError::Other(format!("read package.json: {e}")))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| DeviceError::Other(format!("parse package.json: {e}")))?;
    let has_rn = ["dependencies", "devDependencies"]
        .iter()
        .any(|k| value.get(k).and_then(|d| d.get("react-native")).is_some());
    if !has_rn {
        return Err(DeviceError::Other(
            "package.json has no react-native dependency".into(),
        ));
    }
    let android_dir = root.join("android");
    let app_dir = android_dir.join("app");
    if !app_dir.is_dir() {
        return Err(DeviceError::Other(
            "not a React Native Android project: android/app is missing".into(),
        ));
    }
    let gradle_file = if app_dir.join("build.gradle").is_file() {
        app_dir.join("build.gradle")
    } else if app_dir.join("build.gradle.kts").is_file() {
        app_dir.join("build.gradle.kts")
    } else {
        return Err(DeviceError::Other(
            "missing android/app/build.gradle(.kts)".into(),
        ));
    };
    let source = std::fs::read_to_string(&gradle_file)
        .map_err(|e| DeviceError::Other(format!("read {}: {e}", gradle_file.display())))?;
    let flavors = parse_product_flavors(&source);
    let build_types = parse_build_types(&source);
    let application_id = parse_default_application_id(&source);
    let flavor_ids = resolve_flavor_ids(&source, &flavors, application_id.as_deref());
    let duplicate_ids = duplicate_effective_ids(&flavor_ids);
    Ok(RnProject {
        root: root.to_path_buf(),
        android_dir,
        gradle_file,
        flavors,
        build_types,
        application_id,
        flavor_ids,
        duplicate_ids,
    })
}

fn strip_comments(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '/' {
            if chars.get(i + 1) == Some(&'/') {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            if chars.get(i + 1) == Some(&'*') {
                i += 2;
                while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i = (i + 2).min(chars.len());
                out.push(' ');
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

fn extract_block(src: &str, keyword: &str) -> Option<String> {
    let chars: Vec<char> = strip_comments(src).chars().collect();
    let kw: Vec<char> = keyword.chars().collect();
    let start = chars
        .windows(kw.len())
        .position(|w| w == kw.as_slice())?;
    let mut at = start + kw.len();
    while at < chars.len() && chars[at] != '{' {
        at += 1;
    }
    if at >= chars.len() {
        return None;
    }
    let mut depth = 0usize;
    let mut body = String::new();
    while at < chars.len() {
        let c = chars[at];
        body.push(c);
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        at += 1;
    }
    Some(body)
}

fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn preceding_ident(chars: &[char], open_idx: usize) -> Option<String> {
    let mut i = open_idx;
    while i > 0 && !is_ident_char(chars[i - 1]) {
        i -= 1;
    }
    let end = i;
    while i > 0 && is_ident_char(chars[i - 1]) {
        i -= 1;
    }
    if i == end {
        return None;
    }
    Some(chars[i..end].iter().collect())
}

fn quoted_arg(chars: &[char], open_idx: usize) -> Option<String> {
    let mut i = open_idx + 1;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    let quote = *chars.get(i)?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    i += 1;
    let mut out = String::new();
    while i < chars.len() && chars[i] != quote {
        out.push(chars[i]);
        i += 1;
    }
    Some(out)
}

fn names_in_block(body: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let chars: Vec<char> = body.chars().collect();
    let mut depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' | '(' => {
                if depth == 1 {
                    if c == '(' {
                        if let Some(fn_name) = preceding_ident(&chars, i) {
                            if fn_name == "create" || fn_name == "getByName" {
                                if let Some(name) = quoted_arg(&chars, i) {
                                    if !name.is_empty() {
                                        names.push(name);
                                    }
                                }
                            }
                        }
                    } else if let Some(name) = preceding_ident(&chars, i) {
                        if is_ident_char(name.chars().next().unwrap_or('_')) {
                            if c == '{' {
                                names.push(name);
                            }
                        }
                    }
                }
                depth += 1;
            }
            '}' | ')' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
        i += 1;
    }
    let mut seen = std::collections::HashSet::new();
    names.retain(|n| seen.insert(n.clone()));
    names
}

pub fn parse_product_flavors(gradle: &str) -> Vec<String> {
    extract_block(gradle, "productFlavors")
        .map(|body| names_in_block(&body))
        .unwrap_or_default()
}

pub fn parse_build_types(gradle: &str) -> Vec<String> {
    extract_block(gradle, "buildTypes")
        .map(|body| names_in_block(&body))
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq)]
pub struct FlavorAndroidConfig {
    pub name: String,
    pub application_id: Option<String>,
    pub application_id_suffix: Option<String>,
}

fn assignment_value(body: &str, key: &str) -> Option<String> {
    let chars: Vec<char> = strip_comments(body).chars().collect();
    let kw: Vec<char> = key.chars().collect();
    let mut i = 0;
    while i + kw.len() <= chars.len() {
        let matches = chars[i..i + kw.len()]
            .iter()
            .zip(kw.iter())
            .all(|(a, b)| a == b);
        if matches {
            let before_ok = i == 0 || !is_ident_char(chars[i - 1]);
            let after_idx = i + kw.len();
            let after_ok = chars
                .get(after_idx)
                .map(|c| !is_ident_char(*c))
                .unwrap_or(true);
            if before_ok && after_ok {
                let mut k = after_idx;
                while k < chars.len() && chars[k].is_whitespace() {
                    k += 1;
                }
                if chars.get(k) == Some(&'=') {
                    k += 1;
                    while k < chars.len() && chars[k].is_whitespace() {
                        k += 1;
                    }
                }
                let quote = *chars.get(k)?;
                if quote == '"' || quote == '\'' {
                    return quoted_arg(&chars, k - 1);
                }
            }
        }
        i += 1;
    }
    None
}

fn named_blocks(body: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = body.chars().collect();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '{' | '(' => {
                if chars[i] == '{' && depth == 1 {
                    if let Some(name) = preceding_ident(&chars, i) {
                        if is_ident_char(name.chars().next().unwrap_or(' ')) {
                            let mut d = 0usize;
                            let mut j = i;
                            let mut block = String::new();
                            while j < chars.len() {
                                let c = chars[j];
                                block.push(c);
                                if c == '{' {
                                    d += 1;
                                } else if c == '}' {
                                    d -= 1;
                                    if d == 0 {
                                        break;
                                    }
                                }
                                j += 1;
                            }
                            out.push((name, block));
                        }
                    }
                }
                depth += 1;
            }
            '}' | ')' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
        i += 1;
    }
    out
}

pub fn parse_flavor_config(gradle: &str) -> Vec<FlavorAndroidConfig> {
    extract_block(gradle, "productFlavors")
        .map(|body| {
            named_blocks(&body)
                .into_iter()
                .map(|(name, block)| FlavorAndroidConfig {
                    name,
                    application_id: assignment_value(&block, "applicationId"),
                    application_id_suffix: assignment_value(&block, "applicationIdSuffix"),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_default_application_id(gradle: &str) -> Option<String> {
    extract_block(gradle, "defaultConfig").and_then(|body| assignment_value(&body, "applicationId"))
}

fn resolve_flavor_ids(
    gradle: &str,
    flavors: &[String],
    base: Option<&str>,
) -> Vec<FlavorApplicationId> {
    let configs = parse_flavor_config(gradle);
    flavors
        .iter()
        .map(|name| {
            let cfg = configs.iter().find(|c| &c.name == name);
            let suffix = cfg.and_then(|c| c.application_id_suffix.clone());
            let effective = match cfg.and_then(|c| c.application_id.clone()) {
                Some(id) => Some(id),
                None => base.map(|b| format!("{}{}", b, suffix.clone().unwrap_or_default())),
            };
            FlavorApplicationId {
                flavor: name.clone(),
                suffix,
                effective,
            }
        })
        .collect()
}

fn duplicate_effective_ids(ids: &[FlavorApplicationId]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut dups = Vec::new();
    for id in ids {
        if let Some(effective) = &id.effective {
            if !seen.insert(effective.clone()) && !dups.contains(effective) {
                dups.push(effective.clone());
            }
        }
    }
    dups
}


fn pascal_case(part: &str) -> String {
    let mut chars = part.chars();
    match chars.next() {
        Some(first) => {
            let mut out = String::with_capacity(part.len());
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
            out
        }
        None => String::new(),
    }
}

pub fn assemble_task_name(flavor: Option<&str>, build_type: &str) -> String {
    let mut task = String::from("assemble");
    if let Some(flavor) = flavor {
        if !flavor.is_empty() {
            task.push_str(&pascal_case(flavor));
        }
    }
    task.push_str(&pascal_case(build_type));
    task
}

pub trait HostCommandRunner: Send + Sync {
    fn run(
        &self,
        program: &Path,
        cwd: &Path,
        args: &[&str],
        on_line: &mut dyn FnMut(&str),
    ) -> Result<Output, DeviceError>;
}

pub struct RealHostRunner;

impl HostCommandRunner for RealHostRunner {
    fn run(
        &self,
        program: &Path,
        cwd: &Path,
        args: &[&str],
        on_line: &mut dyn FnMut(&str),
    ) -> Result<Output, DeviceError> {
        let mut child = Command::new(program)
            .current_dir(cwd)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| DeviceError::Other(format!("spawn {}: {e}", program.display())))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| DeviceError::Other("no stderr pipe".into()))?;
        let (tx, rx) = mpsc::channel::<String>();
        let err_reader = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DeviceError::Other("no stdout pipe".into()))?;
        let mut out_all: Vec<String> = Vec::new();
        let mut err_all: Vec<String> = Vec::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            out_all.push(line.clone());
            on_line(&line);
            while let Ok(err_line) = rx.try_recv() {
                err_all.push(err_line.clone());
                on_line(&err_line);
            }
        }
        while let Ok(err_line) = rx.try_recv() {
            err_all.push(err_line.clone());
            on_line(&err_line);
        }
        let _ = err_reader.join();
        let status = child
            .wait()
            .map_err(|e| DeviceError::Other(format!("wait {program:?}: {e}")))?;
        Ok(Output {
            stdout: out_all.join("\n"),
            stderr: err_all.join("\n"),
            success: status.success(),
        })
    }
}

#[derive(Debug)]
pub struct BuildOutcome {
    pub apk_path: PathBuf,
}

pub fn gradlew_program(android_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        android_dir.join("gradlew.bat")
    } else {
        android_dir.join("gradlew")
    }
}

pub fn run_build(
    android_dir: &Path,
    task: &str,
    flavor: Option<&str>,
    build_type: &str,
    runner: &dyn HostCommandRunner,
    on_line: &mut dyn FnMut(&str),
) -> Result<BuildOutcome, DeviceError> {
    let program = gradlew_program(android_dir);
    if !program.is_file() {
        return Err(DeviceError::Other(format!(
            "gradlew not found: {}",
            program.display()
        )));
    }
    let output = runner.run(&program, android_dir, &[task, "--console=plain"], on_line)?;
    if !output.success {
        let tail = output.stderr.trim();
        return Err(DeviceError::Other(if tail.is_empty() {
            format!("gradle {task} failed")
        } else {
            tail.to_string()
        }));
    }
    let apk_path = resolve_apk(android_dir, flavor, build_type)?;
    Ok(BuildOutcome { apk_path })
}

pub fn resolve_apk(
    android_dir: &Path,
    flavor: Option<&str>,
    build_type: &str,
) -> Result<PathBuf, DeviceError> {
    let base = android_dir
        .join("app")
        .join("build")
        .join("outputs")
        .join("apk");
    let mut dir = base;
    if let Some(flavor) = flavor {
        if !flavor.is_empty() {
            dir = dir.join(flavor);
        }
    }
    let dir = dir.join(build_type);
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| DeviceError::Other(format!("read {}: {e}", dir.display())))?;
    let mut candidates: Vec<(bool, String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".apk") {
                return None;
            }
            let lowered = name.to_lowercase();
            Some((
                lowered.contains(&build_type.to_lowercase()),
                name.clone(),
                e.path(),
            ))
        })
        .collect();
    if candidates.is_empty() {
        return Err(DeviceError::Other(format!(
            "no .apk found under {}",
            dir.display()
        )));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    Ok(candidates.remove(0).2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    #[test]
    fn detect_finds_flavors_and_build_types_in_groovy_project() {
        let project = detect(&fixture("rn-groovy")).unwrap();
        assert_eq!(project.flavors, vec!["dev", "prod"]);
        assert_eq!(project.build_types, vec!["debug", "release", "staging"]);
        assert!(project.gradle_file.ends_with("build.gradle"));
        assert!(project.root.ends_with("rn-groovy"));
    }

    #[test]
    fn detect_finds_flavors_and_build_types_in_kotlin_project() {
        let project = detect(&fixture("rn-kotlin")).unwrap();
        assert_eq!(project.flavors, vec!["dev", "prod"]);
        assert_eq!(project.build_types, vec!["release", "debug", "qa"]);
        assert!(project.gradle_file.ends_with("build.gradle.kts"));
    }

    #[test]
    fn detect_lists_no_flavors_when_gradle_has_none() {
        let project = detect(&fixture("rn-plain")).unwrap();
        assert!(project.flavors.is_empty());
        assert_eq!(project.build_types, vec!["debug", "release"]);
    }

    #[test]
    fn detect_rejects_non_rn_project() {
        let err = detect(&fixture("not-rn")).unwrap_err();
        assert!(err.to_string().contains("react-native"));
    }

    #[test]
    fn detect_rejects_rn_project_without_android_dir() {
        let err = detect(&fixture("no-android")).unwrap_err();
        assert!(err.to_string().contains("android"));
    }

    #[test]
    fn detect_rejects_missing_path() {
        let err = detect(&PathBuf::from("/definitely/not/here")).unwrap_err();
        assert!(err.to_string().contains("package.json"));
    }

    #[test]
    fn parses_flavors_ignoring_comments_and_nested_braces() {        let src = r#"
            android {
                // productFlavors { decoy { dimension "x" } }
                /* productFlavors { commented { } } */
                productFlavors {
                    dev {
                        dimension "tier"
                        extraProp {
                            nested {
                                deeper {
                                }
                            }
                        }
                    }
                    prod {
                        dimension "tier"
                    }
                }
            }
        "#;
        assert_eq!(parse_product_flavors(src), vec!["dev", "prod"]);
    }

    #[test]
    fn parses_kotlin_create_and_get_by_name_styles() {
        let src = r#"
            buildTypes {
                release {
                    isMinifyEnabled = false
                }
                getByName("debug") {
                    applicationIdSuffix = ".debug"
                }
                create("qa") {
                }
            }
        "#;
        assert_eq!(parse_build_types(src), vec!["release", "debug", "qa"]);
    }

    #[test]
    fn detect_resolves_application_ids_in_groovy_project() {
        let project = detect(&fixture("rn-groovy")).unwrap();
        assert_eq!(project.application_id.as_deref(), Some("com.rninspector.groovy"));
        assert_eq!(
            project.flavor_ids,
            vec![
                FlavorApplicationId {
                    flavor: "dev".into(),
                    suffix: Some(".dev".into()),
                    effective: Some("com.rninspector.groovy.dev".into()),
                },
                FlavorApplicationId {
                    flavor: "prod".into(),
                    suffix: None,
                    effective: Some("com.rninspector.groovy".into()),
                },
            ]
        );
        assert!(project.duplicate_ids.is_empty());
    }

    #[test]
    fn detect_resolves_application_ids_in_kotlin_project() {
        let project = detect(&fixture("rn-kotlin")).unwrap();
        assert_eq!(project.application_id.as_deref(), Some("com.rninspector.kotlin"));
        assert_eq!(
            project.flavor_ids,
            vec![
                FlavorApplicationId {
                    flavor: "dev".into(),
                    suffix: Some(".dev".into()),
                    effective: Some("com.rninspector.kotlin.dev".into()),
                },
                FlavorApplicationId {
                    flavor: "prod".into(),
                    suffix: None,
                    effective: Some("com.rninspector.kotlin".into()),
                },
            ]
        );
        assert!(project.duplicate_ids.is_empty());
    }

    #[test]
    fn detect_flags_duplicate_effective_ids_and_flavor_override() {
        let project = detect(&fixture("rn-dup")).unwrap();
        assert_eq!(project.flavors, vec!["first", "second", "third"]);
        assert_eq!(project.duplicate_ids, vec!["com.dup.app.s"]);
        let third = project
            .flavor_ids
            .iter()
            .find(|f| f.flavor == "third")
            .unwrap();
        assert_eq!(third.effective.as_deref(), Some("com.dup.other"));
        assert_eq!(third.suffix, None);
    }

    #[test]
    fn detect_leaves_effective_ids_unresolved_when_base_is_missing() {
        let project = detect(&fixture("rn-no-id")).unwrap();
        assert_eq!(project.application_id, None);
        assert!(project.flavor_ids.iter().all(|f| f.effective.is_none()));
        assert!(project.flavor_ids[0].suffix.as_deref() == Some(".dev"));
        assert!(project.duplicate_ids.is_empty());
    }

    #[test]
    fn parses_assignment_value_in_groovy_and_kotlin_styles() {
        assert_eq!(
            assignment_value("applicationId \"com.a.b\"\nother \"x\"", "applicationId").as_deref(),
            Some("com.a.b")
        );
        assert_eq!(
            assignment_value("applicationId = \"com.c.d\"", "applicationId").as_deref(),
            Some("com.c.d")
        );
        assert_eq!(
            assignment_value("applicationIdSuffix '.s'", "applicationIdSuffix").as_deref(),
            Some(".s")
        );
        assert_eq!(assignment_value("minifyEnabled false", "applicationId"), None);
        assert_eq!(
            assignment_value("someApplicationId \"x\"", "applicationId"),
            None
        );
        assert_eq!(
            assignment_value("applicationIdSuffix \"x\"", "applicationId"),
            None
        );
    }

    #[test]
    fn parses_flavor_level_override_blocks() {
        let src = r#"
            android {
                productFlavors {
                    create("dev") {
                        dimension = "tier"
                        applicationIdSuffix = ".dev"
                    }
                    current {
                        applicationId "com.over.app"
                    }
                }
            }
        "#;
        let parsed = parse_flavor_config(src);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "dev");
        assert_eq!(parsed[0].application_id_suffix.as_deref(), Some(".dev"));
        assert_eq!(parsed[0].application_id, None);
        assert_eq!(parsed[1].application_id.as_deref(), Some("com.over.app"));
    }

    #[test]
    fn assemble_task_concatenates_flavor_and_build_type() {
        assert_eq!(assemble_task_name(Some("dev"), "debug"), "assembleDevDebug");
        assert_eq!(assemble_task_name(Some("prod"), "release"), "assembleProdRelease");
        assert_eq!(assemble_task_name(None, "debug"), "assembleDebug");
        assert_eq!(assemble_task_name(Some("qaEnv"), "staging"), "assembleQaEnvStaging");
    }

    struct FakeHostRunner {
        calls: Mutex<Vec<(String, Vec<String>)>>,
        lines: Vec<&'static str>,
        ok: bool,
    }

    impl HostCommandRunner for FakeHostRunner {
        fn run(
            &self,
            program: &Path,
            _cwd: &Path,
            args: &[&str],
            on_line: &mut dyn FnMut(&str),
        ) -> Result<Output, DeviceError> {
            self.calls
                .lock()
                .unwrap()
                .push((
                    program.display().to_string(),
                    args.iter().map(|s| s.to_string()).collect(),
                ));
            for line in &self.lines {
                on_line(line);
            }
            Ok(Output {
                stdout: String::new(),
                stderr: if self.ok { String::new() } else { "gradle failed".into() },
                success: self.ok,
            })
        }
    }

    fn sample_android_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("beholder-buildrun-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_flavored_apk(android: &Path) -> PathBuf {
        let apk_dir = android.join("app/build/outputs/apk/dev/debug");
        std::fs::create_dir_all(&apk_dir).unwrap();
        let apk = apk_dir.join("app-dev-debug.apk");
        std::fs::write(&apk, b"apk-bytes").unwrap();
        apk
    }

    #[test]
    fn run_build_invokes_gradlew_with_task_and_streams_lines() {
        let android = sample_android_dir("invoke");
        std::fs::write(android.join("gradlew"), "#!/bin/sh\n").unwrap();
        let apk = write_flavored_apk(&android);
        let mut lines: Vec<String> = vec![];
        let fake = FakeHostRunner {
            calls: Mutex::new(vec![]),
            lines: vec!["line1", "line2"],
            ok: true,
        };
        let outcome = run_build(&android, "assembleDevDebug", Some("dev"), "debug", &fake, &mut |l| {
            lines.push(l.to_string());
        })
        .unwrap();
        assert_eq!(outcome.apk_path, apk);
        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].0.ends_with("gradlew"));
        assert_eq!(calls[0].1, vec!["assembleDevDebug", "--console=plain"]);
        assert_eq!(lines, vec!["line1", "line2"]);
        let _ = std::fs::remove_dir_all(&android);
    }

    #[test]
    fn run_build_fails_when_gradlew_missing() {
        let android = sample_android_dir("missing");
        let fake = FakeHostRunner {
            calls: Mutex::new(vec![]),
            lines: vec![],
            ok: true,
        };
        let err = run_build(&android, "assembleDebug", None, "debug", &fake, &mut |_| {}).unwrap_err();
        assert!(err.to_string().contains("gradlew not found"));
        assert!(fake.calls.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&android);
    }

    #[test]
    fn run_build_propagates_gradle_failure() {
        let android = sample_android_dir("failure");
        std::fs::write(android.join("gradlew"), "stub").unwrap();
        let fake = FakeHostRunner {
            calls: Mutex::new(vec![]),
            lines: vec![],
            ok: false,
        };
        let err = run_build(&android, "assembleDebug", None, "debug", &fake, &mut |_| {}).unwrap_err();
        assert!(err.to_string().contains("gradle failed"));
        let _ = std::fs::remove_dir_all(&android);
    }

    #[test]
    fn resolve_apk_prefers_apk_matching_build_type() {
        let dir = sample_android_dir("resolve");
        let apk_dir = dir.join("app/build/outputs/apk/dev/debug");
        std::fs::create_dir_all(&apk_dir).unwrap();
        std::fs::write(apk_dir.join("other-variant.apk"), b"apk").unwrap();
        let picked = apk_dir.join("app-dev-debug.apk");
        std::fs::write(&picked, b"apk").unwrap();
        assert_eq!(resolve_apk(&dir, Some("dev"), "debug").unwrap(), picked);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_apk_without_flavor_uses_plain_dir() {
        let dir = sample_android_dir("plain");
        let apk_dir = dir.join("app/build/outputs/apk/debug");
        std::fs::create_dir_all(&apk_dir).unwrap();
        let apk = apk_dir.join("app-debug.apk");
        std::fs::write(&apk, b"apk").unwrap();
        assert_eq!(resolve_apk(&dir, None, "debug").unwrap(), apk);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_apk_errors_when_no_apk_present() {
        let dir = sample_android_dir("noapk");
        let apk_dir = dir.join("app/build/outputs/apk/debug");
        std::fs::create_dir_all(&apk_dir).unwrap();
        let err = resolve_apk(&dir, None, "debug").unwrap_err();
        assert!(err.to_string().contains("apk"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn real_host_runner_streams_stdout_and_stderr_lines() {
        let mut lines: Vec<String> = vec![];
        let out = RealHostRunner
            .run(
                Path::new("/bin/sh"),
                Path::new("/"),
                &["-c", "echo out1; echo err1 1>&2; echo out2"],
                &mut |l| lines.push(l.to_string()),
            )
            .unwrap();
        assert!(out.success);
        assert!(lines.contains(&"out1".to_string()));
        assert!(lines.contains(&"err1".to_string()));
        assert!(lines.contains(&"out2".to_string()));
        assert!(out.stdout.contains("out1"));
        assert!(out.stdout.contains("out2"));
    }

    #[test]
    #[cfg(unix)]
    fn real_host_runner_reports_failure_status() {
        let mut lines: Vec<String> = vec![];
        let out = RealHostRunner
            .run(
                Path::new("/bin/sh"),
                Path::new("/"),
                &["-c", "echo boom 1>&2; exit 3"],
                &mut |l| lines.push(l.to_string()),
            )
            .unwrap();
        assert!(!out.success);
        assert!(out.stderr.contains("boom"));
        assert!(lines.contains(&"boom".to_string()));
    }
}
