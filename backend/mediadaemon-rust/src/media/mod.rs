use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}

impl fmt::Display for PlaybackStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlaybackStatus::Playing => write!(f, "Playing"),
            PlaybackStatus::Paused => write!(f, "Paused"),
            PlaybackStatus::Stopped => write!(f, "Stopped"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TrackState {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub progress_ms: u64,
    pub status: PlaybackStatus,
    pub thumbnail_base64: String,
}

impl TrackState {
    pub fn track_id(&self) -> String {
        format!("{}|{}", self.artist, self.title)
    }
}

#[async_trait::async_trait]
pub trait MediaProvider: Send + Sync {
    async fn current_state(&self) -> Option<TrackState>;
    async fn play(&self);
    async fn pause(&self);
    async fn next(&self);
    async fn previous(&self);
    fn change_notifier(&self) -> Option<&tokio::sync::Notify> { None }
}

pub mod windows;
