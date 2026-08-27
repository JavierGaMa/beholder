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
