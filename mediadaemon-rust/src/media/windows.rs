use std::sync::Arc;
use tokio::sync::Notify;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::DataReader;

use super::{MediaProvider, PlaybackStatus, TrackState};

pub struct WindowsMediaProvider {
    manager: GlobalSystemMediaTransportControlsSessionManager,
    pub change_notify: Notify,
}

impl WindowsMediaProvider {
    pub async fn new() -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
        let provider = Arc::new(Self {
            manager,
            change_notify: Notify::new(),
        });

        let weak = Arc::downgrade(&provider);
        provider.manager.CurrentSessionChanged(
            &TypedEventHandler::new(move |_, _| {
                if let Some(p) = weak.upgrade() {
                    p.change_notify.notify_waiters();
                }
                Ok(())
            }),
        )?;

        Ok(provider)
    }

    fn get_session(&self) -> Option<GlobalSystemMediaTransportControlsSession> {
        self.manager.GetCurrentSession().ok()
    }
}

#[async_trait::async_trait]
impl MediaProvider for WindowsMediaProvider {
    async fn current_state(&self) -> Option<TrackState> {
        let session = self.get_session()?;

        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().ok()?;
        if title.is_empty() {
            return None;
        }

        let artist = props.Artist().unwrap_or_default();
        let album = props.AlbumTitle().unwrap_or_default();
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
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.to_string(),
            duration_ms: (end_time.Duration / 10000) as u64,
            progress_ms: (position.Duration / 10000) as u64,
            status: status_enum,
            thumbnail_base64,
        })
    }

    async fn play(&self) {
        if let Some(session) = self.get_session() {
            let _ = session.TryPlayAsync();
        }
    }

    async fn pause(&self) {
        if let Some(session) = self.get_session() {
            let _ = session.TryPauseAsync();
        }
    }

    async fn next(&self) {
        if let Some(session) = self.get_session() {
            let _ = session.TrySkipNextAsync();
        }
    }

    async fn previous(&self) {
        if let Some(session) = self.get_session() {
            let _ = session.TrySkipPreviousAsync();
        }
    }

    fn change_notifier(&self) -> Option<&tokio::sync::Notify> {
        Some(&self.change_notify)
    }
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
