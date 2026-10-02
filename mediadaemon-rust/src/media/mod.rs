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
    /// How long ago the app wrote `progress_ms`. Zero means the age could not be determined.
    pub position_age_ms: u64,
}

impl TrackState {
    pub fn track_id(&self) -> String {
        format!("{}|{}", self.artist, self.title)
    }
}

/// One SMTC session, as offered in the session picker. Carries no cover art: reading a thumbnail
/// opens an image stream, and doing that for every session on every poll is not affordable.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub app_name: String,
    pub track: TrackState,
}

/// A session that has been selected for detail and for commands.
#[derive(Debug, Clone)]
pub struct ResolvedSession {
    pub id: String,
    pub app_name: String,
    pub track: TrackState,
}

/// `id` is derived from the owning app's user model id rather than from anything SMTC invents,
/// because the API has no session identifier. That granularity is deliberate: changing track does
/// not create a new session, so the user's selection has to survive it, while closing the app does
/// remove the session and the selection has to fall back.
pub fn session_id_for(app_user_model_id: &str) -> String {
    if app_user_model_id.is_empty() {
        // No app id: fall back to a fixed marker so the session is still selectable, at the cost of
        // not being able to tell two unidentified apps apart.
        return "app:unknown".to_string();
    }
    format!("app:{app_user_model_id}")
}

/// Human-readable app name from an app user model id. Only the executable suffix is stripped:
/// anything smarter guesses wrong on ids like `MSEdge_MPV2SimpleMediaApp`.
pub fn app_name_for(app_user_model_id: &str) -> String {
    let stem = app_user_model_id
        .strip_suffix(".exe")
        .or_else(|| app_user_model_id.strip_suffix(".EXE"))
        .unwrap_or(app_user_model_id);
    if stem.is_empty() {
        "Unknown app".to_string()
    } else {
        stem.to_string()
    }
}

#[async_trait::async_trait]
pub trait MediaProvider: Send + Sync {
    /// Detail for one session, with the cover art.
    ///
    /// `None` selects automatically: prefer a session that is playing and, among several, the most
    /// recently updated one. `Some(id)` pins to that session and yields `None` when it has gone, so
    /// a caller falls back instead of acting on a handle that no longer exists.
    async fn resolve(&self, session_id: Option<&str>) -> Option<ResolvedSession>;

    /// Every session SMTC knows about, without cover art.
    ///
    /// Sessions outlive the app that registered them, so a caller should treat a session that is
    /// not playing as history rather than something to control.
    fn sessions(&self) -> Vec<SessionInfo>;

    /// Run a playback command against one session, using the same selection rules as `resolve`.
    async fn command(&self, session_id: Option<&str>, cmd: &str);
}

pub mod windows;
