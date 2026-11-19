use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ColorOverrides {
    pub bg: Option<String>,
    pub surface: Option<String>,
    pub surface_2: Option<String>,
    pub line: Option<String>,
    pub text: Option<String>,
    pub muted: Option<String>,
    pub accent: Option<String>,
    pub ok: Option<String>,
    pub warn: Option<String>,
    pub danger: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConsoleConfig {
    #[serde(default = "default_ring_lines")]
    pub ring_lines: u32,
    #[serde(default = "default_show_tid")]
    pub show_tid: bool,
    #[serde(default = "default_console_buffer")]
    pub default_buffer: String,
}

fn default_ring_lines() -> u32 {
    10000
}
fn default_show_tid() -> bool {
    false
}
fn default_console_buffer() -> String {
    "main".into()
}

impl Default for ConsoleConfig {
    fn default() -> Self {
        ConsoleConfig {
            ring_lines: default_ring_lines(),
            show_tid: default_show_tid(),
            default_buffer: default_console_buffer(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentConfig {
    #[serde(default = "default_agent_enabled")]
    pub enabled: bool,
    #[serde(default = "default_agent_bind")]
    pub bind: String,
    #[serde(default = "default_max_body_chars")]
    pub max_body_chars: usize,
    #[serde(default = "default_ring_requests")]
    pub ring_requests: usize,
    #[serde(default = "default_console_lines")]
    pub console_lines: usize,
}

fn default_agent_enabled() -> bool {
    true
}
fn default_agent_bind() -> String {
    "127.0.0.1:0".into()
}
fn default_max_body_chars() -> usize {
    2048
}
fn default_ring_requests() -> usize {
    5000
}
fn default_console_lines() -> usize {
    200
}

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            enabled: default_agent_enabled(),
            bind: default_agent_bind(),
            max_body_chars: default_max_body_chars(),
            ring_requests: default_ring_requests(),
            console_lines: default_console_lines(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApksConfig {
    #[serde(default = "default_apks_list_url")]
    pub list_url: String,
    #[serde(default)]
    pub download_dir: Option<String>,
}

fn default_apks_list_url() -> String {
    String::new()
}

impl Default for ApksConfig {
    fn default() -> Self {
        ApksConfig {
            list_url: default_apks_list_url(),
            download_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetroConfig {
    #[serde(default = "default_metro_port")]
    pub port: u16,
    #[serde(default)]
    pub capture: bool,
}

fn default_metro_port() -> u16 {
    8081
}

impl Default for MetroConfig {
    fn default() -> Self {
        MetroConfig {
            port: default_metro_port(),
            capture: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct WindowConfig {
    #[serde(default)]
    pub sidebar_opacity: Option<u32>,
    #[serde(default)]
    pub main_pane_glass: Option<bool>,
    #[serde(default)]
    pub blur_radius: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProxyConfig {
    #[serde(default = "default_tls_bypass_hosts")]
    pub tls_bypass_hosts: Vec<String>,
}

fn default_tls_bypass_hosts() -> Vec<String> {
    vec![
        "www.google.com".into(),
        "connectivitycheck.gstatic.com".into(),
        "play.googleapis.com".into(),
    ]
}

impl Default for ProxyConfig {
    fn default() -> Self {
        ProxyConfig {
            tls_bypass_hosts: default_tls_bypass_hosts(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UiConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_accent")]
    pub accent: String,
    #[serde(default = "default_ui_size")]
    pub ui_font_size: u32,
    #[serde(default = "default_mono_size")]
    pub mono_font_size: u32,
    #[serde(default = "default_row_height")]
    pub row_height: u32,
    #[serde(default)]
    pub mono_font_family: Option<String>,
    #[serde(default)]
    pub colors: ColorOverrides,
    #[serde(default)]
    pub console: ConsoleConfig,
    #[serde(default)]
    pub agent: AgentConfig,
    #[serde(default)]
    pub apks: ApksConfig,
    #[serde(default)]
    pub metro: MetroConfig,
    #[serde(default)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub window: WindowConfig,
}

fn default_theme() -> String {
    "paper".into()
}
fn default_accent() -> String {
    "lime".into()
}
fn default_ui_size() -> u32 {
    13
}
fn default_mono_size() -> u32 {
    12
}
fn default_row_height() -> u32 {
    34
}

impl Default for UiConfig {
    fn default() -> Self {
        UiConfig {
            theme: default_theme(),
            accent: default_accent(),
            ui_font_size: default_ui_size(),
            mono_font_size: default_mono_size(),
            row_height: default_row_height(),
            mono_font_family: None,
            colors: ColorOverrides::default(),
            console: ConsoleConfig::default(),
            agent: AgentConfig::default(),
            apks: ApksConfig::default(),
            metro: MetroConfig::default(),
            proxy: ProxyConfig::default(),
            window: WindowConfig::default(),
        }
    }
}

pub fn normalize_accent_color(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let hex = trimmed
        .strip_prefix('#')
        .ok_or_else(|| format!("invalid accent color: {raw}"))?;
    let expanded: String = if hex.len() == 3 {
        hex.chars().flat_map(|c| [c, c]).collect()
    } else if hex.len() == 6 {
        hex.to_string()
    } else {
        return Err(format!("invalid accent color: {raw}"));
    };
    if !expanded.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid accent color: {raw}"));
    }
    Ok(Some(format!("#{expanded}").to_lowercase()))
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

const TEMPLATE_HEADER: &str = "# Beholder UI configuration\n# Edit and save - changes apply live.\n# Custom colors are optional: uncomment or add under [colors].\n\n";

const METRO_CAPTURE_DOC: &str = "# capture = true also records Metro traffic to loopback on the metro port;\n# false (default) relays it as a pass-through without recording\n";

const PROXY_TLS_BYPASS_DOC: &str = "# tls_bypass_hosts = CONNECT tunnels to these hosts are relayed without TLS\n# interception so Android network validation probes see the real certificates;\n# set to an empty list to intercept everything\n";

const WINDOW_OVERRIDE_DOC: &str = "# keys are optional per-field overrides; unset fields follow the theme's\n# curated look, so delete the section to return to it\n# sidebar_opacity = 86      # 0-100, 100 = solid\n# main_pane_glass = false   # also glaze the request panes\n# blur_radius = 30          # 0-64, desktop blur behind the glaze\n";

pub fn config_path(app_data: &std::path::Path) -> PathBuf {
    app_data.join("config.toml")
}

pub fn load(dir: &std::path::Path) -> Result<UiConfig, ConfigError> {
    let path = config_path(dir);
    if !path.exists() {
        let config = UiConfig::default();
        write_config(dir, &config)?;
        return Ok(config);
    }
    let raw = std::fs::read_to_string(&path)?;
    let mut config =
        toml::from_str::<UiConfig>(&raw).map_err(|e| ConfigError::Parse(e.to_string()))?;
    config.window.sidebar_opacity = config.window.sidebar_opacity.map(|v| v.min(100));
    config.window.blur_radius = config
        .window
        .blur_radius
        .map(|v| v.min(crate::window_blur::MAX_RADIUS));
    Ok(config)
}

pub fn write_config(dir: &std::path::Path, config: &UiConfig) -> Result<(), ConfigError> {
    std::fs::create_dir_all(dir)?;
    let body = toml::to_string_pretty(config).map_err(|e| ConfigError::Parse(e.to_string()))?;
    let body = body.replacen("[metro]", &format!("[metro]\n{METRO_CAPTURE_DOC}"), 1);
    let body = body.replacen("[proxy]", &format!("[proxy]\n{PROXY_TLS_BYPASS_DOC}"), 1);
    let body = body.replacen("[window]", &format!("[window]\n{WINDOW_OVERRIDE_DOC}"), 1);
    std::fs::write(config_path(dir), format!("{}{}", TEMPLATE_HEADER, body))
        .map_err(ConfigError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accent_color_accepts_none_and_blank() {
        assert_eq!(normalize_accent_color(None).unwrap(), None);
        assert_eq!(normalize_accent_color(Some("")).unwrap(), None);
        assert_eq!(normalize_accent_color(Some("   ")).unwrap(), None);
    }

    #[test]
    fn normalize_accent_color_lowercases_six_digit_hex() {
        assert_eq!(
            normalize_accent_color(Some("#FF00AA")).unwrap(),
            Some("#ff00aa".into())
        );
    }

    #[test]
    fn normalize_accent_color_expands_three_digit_hex() {
        assert_eq!(
            normalize_accent_color(Some("#F0a")).unwrap(),
            Some("#ff00aa".into())
        );
    }

    #[test]
    fn normalize_accent_color_rejects_non_hex_shapes() {
        assert!(normalize_accent_color(Some("ff00aa")).is_err());
        assert!(normalize_accent_color(Some("#GGGGGG")).is_err());
        assert!(normalize_accent_color(Some("#12345")).is_err());
        assert!(normalize_accent_color(Some("#1234567")).is_err());
        assert!(normalize_accent_color(Some("red")).is_err());
    }

    #[test]
    fn roundtrip_toml_with_custom_accent_command_shape() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-accent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.colors.accent = normalize_accent_color(Some("#22D3EE")).unwrap();
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.colors.accent, Some("#22d3ee".into()));
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("accent = \"#22d3ee\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_overrides() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.mono_font_size = 13;
        config.mono_font_family = Some("JetBrains Mono".into());
        config.colors.accent = Some("#22d3ee".into());
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.starts_with("# Beholder UI configuration"));
        assert!(raw.contains("mono_font_size = 13"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn defaults_when_missing_fields() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.theme, "carbon");
        assert_eq!(loaded.ui_font_size, 13);
        assert_eq!(loaded.row_height, 34);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_console_section() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-console-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.console.ring_lines = 5000;
        config.console.show_tid = true;
        config.console.default_buffer = "system".into();
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[console]"));
        assert!(raw.contains("ring_lines = 5000"));
        assert!(raw.contains("show_tid = true"));
        assert!(raw.contains("default_buffer = \"system\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn console_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-console-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.console, ConsoleConfig::default());
        assert_eq!(loaded.console.ring_lines, 10000);
        assert!(!loaded.console.show_tid);
        assert_eq!(loaded.console.default_buffer, "main");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn agent_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-agent-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.agent, AgentConfig::default());
        assert!(loaded.agent.enabled);
        assert_eq!(loaded.agent.bind, "127.0.0.1:0");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_apks_section() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-apks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.apks.list_url = "https://example.com/contenidos?restype=container&comp=list".into();
        config.apks.download_dir = Some("~/Downloads/beholder-apks".into());
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[apks]"));
        assert!(raw.contains(
            "list_url = \"https://example.com/contenidos?restype=container&comp=list\""
        ));
        assert!(raw.contains("download_dir = \"~/Downloads/beholder-apks\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apks_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-apks-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.apks, ApksConfig::default());
        assert!(loaded.apks.list_url.is_empty());
        assert!(loaded.apks.download_dir.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apks_download_dir_defaults_when_key_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-apks-dir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            config_path(&dir),
            "[apks]\nlist_url = \"https://example.com/contenidos\"\n",
        )
        .unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.apks.list_url, "https://example.com/contenidos");
        assert!(loaded.apks.download_dir.is_none());
        let mut config = UiConfig::default();
        config.apks.list_url = "https://example.com/contenidos".into();
        write_config(&dir, &config).unwrap();
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(!raw.contains("download_dir"));
        let reloaded = load(&dir).unwrap();
        assert_eq!(reloaded, config);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn metro_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-metro-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.metro, MetroConfig::default());
        assert_eq!(loaded.metro.port, 8081);
        assert!(!loaded.metro.capture);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_metro_section() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-metro-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.metro.port = 8082;
        config.metro.capture = true;
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        assert_eq!(loaded.metro.port, 8082);
        assert!(loaded.metro.capture);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[metro]"));
        assert!(raw.contains("port = 8082"));
        assert!(raw.contains("capture = true\n"));
        assert!(!metro_section(&raw).contains("bypass"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn metro_capture_defaults_false_in_written_template() {
        let dir = std::env::temp_dir().join(format!(
            "bh-cfg-metro-tpl-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let config = UiConfig::default();
        write_config(&dir, &config).unwrap();
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("# capture = true also records Metro traffic"));
        assert!(raw.contains("capture = false"));
        assert!(!metro_section(&raw).contains("bypass"));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn metro_section(raw: &str) -> String {
        raw.split("[metro]")
            .nth(1)
            .unwrap_or("")
            .split('[')
            .next()
            .unwrap_or("")
            .to_string()
    }

    #[test]
    fn proxy_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-proxy-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.proxy, ProxyConfig::default());
        assert_eq!(
            loaded.proxy.tls_bypass_hosts,
            vec![
                "www.google.com".to_string(),
                "connectivitycheck.gstatic.com".to_string(),
                "play.googleapis.com".to_string(),
            ]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_proxy_section() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-proxy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.proxy.tls_bypass_hosts = vec!["internal.example.com".into()];
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        assert_eq!(loaded.proxy.tls_bypass_hosts, vec!["internal.example.com"]);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[proxy]"));
        assert!(raw.contains("internal.example.com"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn proxy_defaults_in_written_template() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-proxy-tpl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let config = UiConfig::default();
        write_config(&dir, &config).unwrap();
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[proxy]"));
        assert!(raw.contains(
            "# tls_bypass_hosts = CONNECT tunnels to these hosts are relayed without TLS"
        ));
        assert!(raw.contains("www.google.com"));
        assert!(raw.contains("connectivitycheck.gstatic.com"));
        assert!(raw.contains("play.googleapis.com"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn roundtrip_toml_with_window_section() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-window-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = UiConfig::default();
        config.window.sidebar_opacity = Some(72);
        config.window.main_pane_glass = Some(true);
        config.window.blur_radius = Some(40);
        write_config(&dir, &config).unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded, config);
        assert_eq!(loaded.window.sidebar_opacity, Some(72));
        assert_eq!(loaded.window.main_pane_glass, Some(true));
        assert_eq!(loaded.window.blur_radius, Some(40));
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[window]"));
        assert!(raw.contains("sidebar_opacity = 72"));
        assert!(raw.contains("main_pane_glass = true"));
        assert!(raw.contains("blur_radius = 40"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn window_defaults_when_section_missing() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-window-def-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "theme = \"carbon\"\n").unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.window, WindowConfig::default());
        assert_eq!(loaded.window.sidebar_opacity, None);
        assert_eq!(loaded.window.main_pane_glass, None);
        assert_eq!(loaded.window.blur_radius, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn window_values_clamped_on_load() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-window-cl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            config_path(&dir),
            "[window]\nsidebar_opacity = 140\nblur_radius = 99\n",
        )
        .unwrap();
        let loaded = load(&dir).unwrap();
        assert_eq!(loaded.window.sidebar_opacity, Some(100));
        assert_eq!(loaded.window.blur_radius, Some(64));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn window_override_doc_in_written_template() {
        let dir = std::env::temp_dir().join(format!("bh-cfg-window-doc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let config = UiConfig::default();
        write_config(&dir, &config).unwrap();
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(raw.contains("[window]"));
        assert!(raw.contains("# sidebar_opacity = 86"));
        assert!(!raw.contains("sidebar_opacity = 86\n"));
        let reloaded = load(&dir).unwrap();
        assert_eq!(reloaded, config);
        std::fs::remove_dir_all(&dir).ok();
    }
}
