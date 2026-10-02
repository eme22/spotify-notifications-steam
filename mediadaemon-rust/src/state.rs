use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::media::{MediaProvider, TrackState};

/// Builds the `/state` payload on demand, caching only what is expensive to recompute.
///
/// The payload used to be refreshed on a timer and shared by every caller, which assumed there was
/// exactly one session worth reporting on. With several sessions that breaks twice over: a timer
/// cannot know which session the caller wants, and a cache shared across sessions leaks one
/// session's cover art and play state into another's response. So the state is derived per request
/// and the only cache left is the cover art, the one thing that costs a real read.
pub struct StateBuilder {
    thumbnails: RwLock<HashMap<String, String>>,
    provider: Arc<dyn MediaProvider>,
}

/// Cover art for one session per track, capped so a long session with many track changes cannot grow
/// the map without bound.
const MAX_CACHED_THUMBNAILS: usize = 32;

impl StateBuilder {
    pub fn new(provider: Arc<dyn MediaProvider>) -> Arc<Self> {
        Arc::new(Self {
            thumbnails: RwLock::new(HashMap::new()),
            provider,
        })
    }

    /// The state of the requested session, or of whichever session is playing when none is named.
    ///
    /// Returns the literal `null` when there is nothing to report, which is what the frontend
    /// already treats as "no session".
    pub async fn build(&self, session_id: Option<&str>) -> String {
        let Some(resolved) = self.provider.resolve(session_id).await else {
            return "null".to_string();
        };

        let track = resolved.track;
        let status_str = track.status.to_string();

        // SMTC does not advance Position on its own: the app writes it, and LastUpdatedTime records
        // when. The sampled value therefore describes the track as it was at that moment, not as it
        // is now, and for a playing session the two can be far apart. While playing, playback
        // advances with the wall clock, so adding the sample's age is what makes this a current
        // position. Without it the value stays frozen for as long as the app goes without
        // republishing, and the seek bar's local estimate overshoots it and snaps back on a loop.
        // While paused the position does not advance, so the sampled value is already correct.
        let advanced = if status_str == "Playing" {
            track.progress_ms.saturating_add(track.position_age_ms)
        } else {
            track.progress_ms
        };
        let progress = if track.duration_ms > 0 {
            advanced.min(track.duration_ms)
        } else {
            advanced
        };

        let image = self.thumbnail_for(&resolved.id, &track).await;

        serde_json::json!({
            "session": resolved.id,
            "app": resolved.app_name,
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "duration": track.duration_ms,
            "progress": progress,
            "status": status_str,
            "image": image,
        })
        .to_string()
    }

    /// Cover art for this session and track, fetched at most once per track.
    ///
    /// Apps commonly register the new track before its art is readable, which is why a miss is
    /// retried briefly rather than cached as "no art": caching the failure would leave the player
    /// without a cover for the rest of the track.
    async fn thumbnail_for(&self, session_id: &str, track: &TrackState) -> String {
        let key = format!("{session_id}|{}", track.track_id());

        if let Some(cached) = self.thumbnails.read().await.get(&key) {
            return cached.clone();
        }

        if track.thumbnail_base64.is_empty() {
            for attempt in 0..5 {
                if attempt > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
                if let Some(retry) = self.provider.resolve(Some(session_id)).await {
                    if !retry.track.thumbnail_base64.is_empty() {
                        return self.store_thumbnail(key, retry.track.thumbnail_base64).await;
                    }
                }
            }
            return String::new();
        }

        self.store_thumbnail(key, track.thumbnail_base64.clone()).await
    }

    async fn store_thumbnail(&self, key: String, image: String) -> String {
        let mut cache = self.thumbnails.write().await;
        if cache.len() >= MAX_CACHED_THUMBNAILS {
            // HashMap has no cheap eviction order. Clearing wholesale is fine because rebuilding is
            // just another art read, and this only triggers after dozens of track changes.
            cache.clear();
        }
        cache.insert(key, image.clone());
        image
    }
}
