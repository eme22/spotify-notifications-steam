use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

#[derive(Clone)]
pub struct LogEntry {
    pub level: String,
    pub message: String,
}

#[derive(Clone)]
pub struct LogBuffer(Arc<Mutex<VecDeque<LogEntry>>>);

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self(Arc::new(Mutex::new(VecDeque::with_capacity(capacity))))
    }

    pub fn drain(&self) -> Vec<LogEntry> {
        self.0.lock().unwrap().drain(..).collect()
    }
}

impl<S: Subscriber> Layer<S> for LogBuffer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if *event.metadata().level() < tracing::Level::INFO {
            return;
        }

        let mut visitor = FieldVisitor {
            message: String::new(),
            extra: Vec::new(),
        };
        event.record(&mut visitor);

        let mut msg = visitor.message;
        for (k, v) in visitor.extra {
            msg.push_str(&format!(" {}={}", k, v));
        }

        let entry = LogEntry {
            level: event.metadata().level().to_string(),
            message: msg,
        };

        let mut queue = self.0.lock().unwrap();
        if queue.len() == queue.capacity() {
            queue.pop_front();
        }
        queue.push_back(entry);
    }
}

struct FieldVisitor {
    message: String,
    extra: Vec<(String, String)>,
}

impl tracing::field::Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let name = field.name();
        let val = format!("{:?}", value);
        if name == "message" {
            self.message = val;
        } else {
            self.extra.push((name.to_string(), val));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        let name = field.name();
        if name == "message" {
            self.message = value.to_string();
        } else {
            self.extra.push((name.to_string(), value.to_string()));
        }
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.extra
            .push((field.name().to_string(), value.to_string()));
    }
}
