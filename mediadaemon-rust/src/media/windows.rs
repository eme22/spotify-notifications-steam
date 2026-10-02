use std::sync::Arc;
use std::time::SystemTime;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    GlobalSystemMediaTransportControlsSessionTimelineProperties,
};
use windows::Storage::Streams::DataReader;

use super::{MediaProvider, PlaybackStatus, ResolvedSession, SessionInfo, TrackState};

pub struct WindowsMediaProvider {
    manager: GlobalSystemMediaTransportControlsSessionManager,
}

impl WindowsMediaProvider {
    pub async fn new() -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
        Ok(Arc::new(Self { manager }))
    }
}

/// Age of the app's timeline sample.
///
/// SMTC does not advance `Position` on its own. The app writes a new `Position` together with a
/// matching `LastUpdatedTime` whenever it chooses to, which for some players means every few
/// seconds and for others only on a state change. So `Position` describes the track as it was when
/// the sample was taken, not as it is now, and for a playing session the two can be minutes apart.
///
/// `DateTime` is a plain struct wrapping `UniversalTime`, in 100ns ticks since 1601-01-01, and the
/// windows crate exposes no conversion helpers for it in 0.58. Subtracting the 1601-to-1970 offset
/// turns it into something comparable to `SystemTime`.
fn sample_age_ms(timeline: &GlobalSystemMediaTransportControlsSessionTimelineProperties) -> u64 {
    let Ok(sampled) = timeline.LastUpdatedTime() else {
        return 0;
    };
    let unix_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|since_epoch| since_epoch.as_millis() as i64)
        .unwrap_or_default();
    let sampled_unix_ms = (sampled.UniversalTime / 10_000) - 11_644_473_600_000;
    (unix_ms - sampled_unix_ms).max(0) as u64
}

#[async_trait::async_trait]
impl MediaProvider for WindowsMediaProvider {
    async fn resolve(&self, session_id: Option<&str>) -> Option<ResolvedSession> {
        let sessions = self.all_sessions();
        let session = self.select(&sessions, session_id)?;

        let track = read_track(session).await?;
        Some(ResolvedSession {
            id: session_id_of(session),
            app_name: app_name_of(session),
            track,
        })
    }

    fn sessions(&self) -> Vec<SessionInfo> {
        let all = self.all_sessions();
        all.iter()
            .filter_map(|session| {
                let track = read_blocking(session)?;
                Some(SessionInfo {
                    id: session_id_of(session),
                    app_name: app_name_of(session),
                    track,
                })
            })
            .collect()
    }

    async fn command(&self, session_id: Option<&str>, cmd: &str) {
        let sessions = self.all_sessions();
        let Some(session) = self.select(&sessions, session_id) else {
            tracing::warn!("Command {} ignored: no session matched {:?}", cmd, session_id);
            return;
        };

        match cmd {
            "play" => {
                let _ = session.TryPlayAsync();
            }
            "pause" => {
                let _ = session.TryPauseAsync();
            }
            "next" => {
                let _ = session.TrySkipNextAsync();
            }
            "previous" => {
                let _ = session.TrySkipPreviousAsync();
            }
            other => tracing::warn!("Unsupported command: {}", other),
        }
    }
}

impl WindowsMediaProvider {
    fn all_sessions(&self) -> Vec<GlobalSystemMediaTransportControlsSession> {
        let Ok(sessions) = self.manager.GetSessions() else {
            return Vec::new();
        };
        sessions.into_iter().collect()
    }

    /// Find the session a request refers to.
    ///
    /// `GetCurrentSession` is deliberately not used. It is an arbitration result that follows
    /// whichever app the system considers foreground, so pausing one app hands the plugin a
    /// different one. A caller that names a session gets exactly that one, and a caller that names
    /// none gets the session that is actually playing.
    fn select<'a>(
        &self,
        sessions: &'a [GlobalSystemMediaTransportControlsSession],
        session_id: Option<&str>,
    ) -> Option<&'a GlobalSystemMediaTransportControlsSession> {
        match session_id {
            Some(wanted) => sessions
                .iter()
                .find(|candidate| session_id_of(candidate) == wanted),
            None => sessions
                .iter()
                .map(|session| (is_playing(session), last_updated(session), session))
                .max_by_key(|(playing, updated, _)| (*playing, *updated))
                .map(|(_, _, session)| session),
        }
    }
}

fn session_id_of(session: &GlobalSystemMediaTransportControlsSession) -> String {
    let aumid = session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default();
    super::session_id_for(&aumid)
}

fn app_name_of(session: &GlobalSystemMediaTransportControlsSession) -> String {
    let aumid = session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default();
    super::app_name_for(&aumid)
}

fn is_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|status| status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false)
}

/// Raw 100ns ticks since 1601-01-01, as SMTC records it. Used only to rank sessions by recency, so
/// it never has to mean anything absolute.
fn last_updated(session: &GlobalSystemMediaTransportControlsSession) -> i64 {
    session
        .GetTimelineProperties()
        .ok()
        .and_then(|timeline| timeline.LastUpdatedTime().ok())
        .map(|value| value.UniversalTime)
        .unwrap_or(i64::MIN)
}

/// Read a session's track without the cover art.
///
/// Cover art opens an image stream, and `sessions()` runs for every session, so the light read is
/// kept separate from `read_track`.
fn read_blocking(session: &GlobalSystemMediaTransportControlsSession) -> Option<TrackState> {
    let props = session
        .TryGetMediaPropertiesAsync()
        .ok()
        .and_then(|pending| pending.get().ok());
    let title = props
        .as_ref()
        .and_then(|props| props.Title().ok())
        .map(|value| value.to_string())?;
    if title.is_empty() {
        return None;
    }

    let artist = props
        .as_ref()
        .and_then(|props| props.Artist().ok())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let album = props
        .as_ref()
        .and_then(|props| props.AlbumTitle().ok())
        .map(|value| value.to_string())
        .unwrap_or_default();

    let timeline = session.GetTimelineProperties().ok()?;
    let status = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())?;

    let status_enum = match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => PlaybackStatus::Playing,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    };

    Some(TrackState {
        title,
        artist,
        album,
        duration_ms: (timeline.EndTime().ok()?.Duration / 10000) as u64,
        progress_ms: (timeline.Position().ok()?.Duration / 10000) as u64,
        status: status_enum,
        thumbnail_base64: String::new(),
        position_age_ms: sample_age_ms(&timeline),
    })
}

async fn read_track(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<TrackState> {
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().ok()?.to_string();
    if title.is_empty() {
        return None;
    }

    let artist = props.Artist().unwrap_or_default().to_string();
    let album = props.AlbumTitle().unwrap_or_default().to_string();
    let timeline = session.GetTimelineProperties().ok()?;
    let playback_info = session.GetPlaybackInfo().ok()?;

    let position = timeline.Position().ok()?;
    let end_time = timeline.EndTime().ok()?;
    let status = playback_info.PlaybackStatus().ok()?;

    let status_enum = match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => PlaybackStatus::Playing,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    };

    let thumbnail_base64 = extract_thumbnail(&props).await;

    Some(TrackState {
        title,
        artist,
        album,
        duration_ms: (end_time.Duration / 10000) as u64,
        progress_ms: (position.Duration / 10000) as u64,
        status: status_enum,
        thumbnail_base64,
        position_age_ms: sample_age_ms(&timeline),
    })
}

async fn extract_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> String {
    let thumbnail = match props.Thumbnail() {
        Ok(t) => t,
        Err(_) => return String::new(),
    };

    let stream = match thumbnail.OpenReadAsync() {
        Ok(op) => match op.get() {
            Ok(s) => s,
            Err(_) => return String::new(),
        },
        Err(_) => return String::new(),
    };

    let size = match stream.Size() {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    if size == 0 {
        return String::new();
    }

    let reader = match DataReader::CreateDataReader(&stream) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };

    let loaded = match reader.LoadAsync(size as u32) {
        Ok(op) => match op.get() {
            Ok(n) => n,
            Err(_) => return String::new(),
        },
        Err(_) => return String::new(),
    };

    if loaded == 0 {
        return String::new();
    }

    let mut buffer = vec![0u8; size as usize];
    if reader.ReadBytes(&mut buffer).is_err() {
        return String::new();
    }

    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(&buffer)
}
