use crate::types::TrafficEvent;

pub trait TrafficSink: Send + Sync {
    fn emit(&self, event: TrafficEvent);
}

#[derive(Default)]
pub struct RecordingSink {
    pub events: std::sync::Mutex<Vec<TrafficEvent>>,
}

impl TrafficSink for RecordingSink {
    fn emit(&self, event: TrafficEvent) {
        self.events.lock().unwrap().push(event);
    }
}
