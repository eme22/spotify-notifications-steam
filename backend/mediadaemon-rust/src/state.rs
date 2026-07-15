use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::media::MediaProvider;

pub struct CachedState {
    json: Arc<RwLock<String>>,
    last_track_id: RwLock<String>,
    last_status: RwLock<String>,
    last_progress: RwLock<u64>,
    last_write_time: RwLock<Option<Instant>>,
    cached_thumbnail: RwLock<String>,
    provider: Arc<dyn MediaProvider>,
}

impl CachedState {
    pub fn new(provider: Arc<dyn MediaProvider>) -> Arc<Self> {
        Arc::new(Self {
            json: Arc::new(RwLock::new("null".to_string())),
            last_track_id: RwLock::new(String::new()),
            last_status: RwLock::new(String::new()),
            last_progress: RwLock::new(0),
            last_write_time: RwLock::new(None),
            cached_thumbnail: RwLock::new(String::new()),
            provider,
        })
    }

    pub fn json(&self) -> Arc<RwLock<String>> {
        self.json.clone()
    }

    pub async fn refresh(&self) {
        let state = self.provider.current_state().await;
        let mut json = self.json.write().await;

        match state {
            None => {
                *json = "null".to_string();
                *self.last_track_id.write().await = "null".to_string();
                *self.last_status.write().await = String::new();
                *self.last_write_time.write().await = Some(Instant::now());
            }
            Some(track) => {
                let track_id = track.track_id();
                let status_str = track.status.to_string();
                let progress = track.progress_ms;

                let mut thumbnail = self.cached_thumbnail.write().await;
                let last_track_id = self.last_track_id.read().await.clone();

                if track_id != last_track_id || thumbnail.is_empty() {
                    if track_id != last_track_id && !thumbnail.is_empty() {
                        *thumbnail = String::new();
                        let mut attempts = 5;
                        while attempts > 0 {
                            if let Some(state) = self.provider.current_state().await {
                                if !state.thumbnail_base64.is_empty()
                                    && state.thumbnail_base64 != *thumbnail
                                {
                                    *thumbnail = state.thumbnail_base64.clone();
                                    break;
                                }
                            }
                            attempts -= 1;
                            if attempts > 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            }
                        }
                    }
                    if thumbnail.is_empty() {
                        if let Some(state) = self.provider.current_state().await {
                            if !state.thumbnail_base64.is_empty() {
                                *thumbnail = state.thumbnail_base64;
                            }
                        }
                    }
                }

                let should_write = {
                    let last_track_id = self.last_track_id.read().await;
                    let last_status = self.last_status.read().await;
                    let last_write_time = self.last_write_time.read().await;

                    last_write_time.is_none()
                        || track_id != *last_track_id
                        || status_str != *last_status
                        || {
                            let last_progress = *self.last_progress.read().await;
                            let expected = if status_str == "Playing" {
                                if let Some(t) = *last_write_time {
                                    last_progress + t.elapsed().as_millis() as u64
                                } else {
                                    last_progress
                                }
                            } else {
                                last_progress
                            };
                            let drift = if progress > expected {
                                progress - expected
                            } else {
                                expected - progress
                            };
                            drift > 3000
                                || last_write_time.map_or(false, |t| t.elapsed().as_secs() >= 15)
                        }
                };

                if should_write {
                    let state_obj = serde_json::json!({
                        "title": track.title,
                        "artist": track.artist,
                        "album": track.album,
                        "duration": track.duration_ms,
                        "progress": track.progress_ms,
                        "status": track.status.to_string(),
                        "image": thumbnail.clone(),
                    });

                    *json = serde_json::to_string(&state_obj).unwrap_or_else(|_| "null".to_string());
                    *self.last_track_id.write().await = track_id;
                    *self.last_status.write().await = status_str;
                    *self.last_progress.write().await = progress;
                    *self.last_write_time.write().await = Some(std::time::Instant::now());
                }
            }
        }
    }
}
