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
}

fn default_theme() -> String {
    "obsidian".into()
}
fn default_accent() -> String {
    "cyan".into()
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
}
