use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Device {
    pub serial: String,
    pub state: DeviceState,
    pub is_emulator: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DeviceState {
    Online,
    Offline,
    Unauthorized,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AvdInfo {
    pub name: String,
    pub device: Option<String>,
    pub image_tag: Option<String>,
    pub abi: Option<String>,
    pub api_level: Option<u32>,
    pub beholder_ready: bool,
    pub running: bool,
    #[serde(skip_serializing)]
    pub path: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SystemImage {
    pub pkg: String,
    pub api: u32,
    pub tag: String,
    pub abi: String,
    pub installed: bool,
}
