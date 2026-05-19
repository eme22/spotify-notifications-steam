import { STORAGE_KEYS } from "../constants/keys";
import { console } from "../utils/logger";

// Shared reactive state
export let currentTrackState: any = null;
export let trackStateListeners: ((track: any) => void)[] = [];
export const nativePlaybackCallbacks = new Set<(state: any) => void>();
export const nativePositionCallbacks = new Set<(pos: number) => void>();

export const isSyncEnabled = () => localStorage.getItem(STORAGE_KEYS.SYNC_NATIVE) !== "false";
export const isVolumeSyncEnabled = () => localStorage.getItem(STORAGE_KEYS.SYNC_VOLUME) !== "false";

export function getMockMusicTrack() {
    let repeatStatus = 0;
    if (currentTrackState?.repeat_state === "context") {
        repeatStatus = 1;
    } else if (currentTrackState?.repeat_state === "track") {
        repeatStatus = 2;
    }

    return {
        uSoundtrackAppId: 0,
        ePlaybackStatus: currentTrackState?.is_playing ? 1 : 2, // 1 = Playing, 2 = Paused
        eRepeatStatus: repeatStatus,
        bShuffle: currentTrackState?.shuffle_state ?? false,
        nVolume: currentTrackState?.volume_percent ?? 100,
        nActiveTrack: 0,
        nLengthInMsec: currentTrackState?.duration_ms || 0
    };
}

export function syncStateToSteamUI() {
    if (!isSyncEnabled() || !currentTrackState) return;

    const mockTrack = getMockMusicTrack();
    nativePlaybackCallbacks.forEach(cb => {
        try {
            cb(mockTrack);
        } catch (e) {
            console.error("Error invoking native playback observer:", e);
        }
    });

    const currentSeconds = Math.floor((currentTrackState.progress_ms || 0) / 1000);
    nativePositionCallbacks.forEach(cb => {
        try {
            cb(currentSeconds);
        } catch (e) {
            console.error("Error invoking native position observer:", e);
        }
    });
}

let progressTimer: any = null;

export function updateTrackState(track: any) {
    currentTrackState = track;
    
    // Clear old progress background timer
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }

    // Set up smooth progress seekbar increments in native Steam UI
    if (currentTrackState && currentTrackState.is_playing) {
        progressTimer = setInterval(() => {
            if (currentTrackState && currentTrackState.is_playing) {
                currentTrackState.progress_ms = (currentTrackState.progress_ms || 0) + 1000;
                if (currentTrackState.progress_ms > currentTrackState.duration_ms) {
                    currentTrackState.progress_ms = currentTrackState.duration_ms;
                }
                syncStateToSteamUI();
            }
        }, 1000);
    }

    trackStateListeners.forEach(listener => {
        try {
            listener(track);
        } catch (e) {
            console.error("Error in track listener:", e);
        }
    });

    syncStateToSteamUI();
}

export function onTrackChange(callback: (track: any) => void) {
    trackStateListeners.push(callback);
    return () => {
        trackStateListeners = trackStateListeners.filter(cb => cb !== callback);
    };
}
