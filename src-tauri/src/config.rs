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
}

fn default_theme() -> String {
    "contrast".into()
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
        }
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

const TEMPLATE_HEADER: &str = "# Beholder UI configuration\n# Edit and save - changes apply live.\n# Custom colors are optional: uncomment or add under [colors].\n\n";

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
    toml::from_str::<UiConfig>(&raw).map_err(|e| ConfigError::Parse(e.to_string()))
}

pub fn write_config(dir: &std::path::Path, config: &UiConfig) -> Result<(), ConfigError> {
    std::fs::create_dir_all(dir)?;
    let body = toml::to_string_pretty(config).map_err(|e| ConfigError::Parse(e.to_string()))?;
    std::fs::write(config_path(dir), format!("{}{}", TEMPLATE_HEADER, body))
        .map_err(ConfigError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
