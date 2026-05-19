import { console } from "../utils/logger";
import { postToChannel } from "../services/monitoring";
import { 
    isSyncEnabled, 
    isVolumeSyncEnabled, 
    currentTrackState, 
    syncStateToSteamUI, 
    getMockMusicTrack, 
    nativePlaybackCallbacks, 
    nativePositionCallbacks 
} from "../services/state";

export function hookNativeControls() {
    const Music = (window as any).SteamClient?.Music;
    if (!Music) {
        console.warn("SteamClient.Music not found, skipped native control hooking.");
        return;
    }

    // Intercept Play/Pause
    const originalTogglePlayPause = Music.TogglePlayPause;
    Music.TogglePlayPause = function() {
        if (isSyncEnabled() && currentTrackState) {
            postToChannel({ type: "PLAYBACK_COMMAND", command: currentTrackState.is_playing ? "pause" : "play" });
            
            // Optimistic update
            currentTrackState.is_playing = !currentTrackState.is_playing;
            syncStateToSteamUI();
        } else {
            originalTogglePlayPause.apply(this, arguments);
        }
    };

    // Intercept Next Song
    const originalPlayNext = Music.PlayNext;
    Music.PlayNext = function() {
        if (isSyncEnabled()) {
            postToChannel({ type: "PLAYBACK_COMMAND", command: "next" });
        } else {
            originalPlayNext.apply(this, arguments);
        }
    };

    // Intercept Previous Song
    const originalPlayPrevious = Music.PlayPrevious;
    Music.PlayPrevious = function() {
        if (isSyncEnabled()) {
            postToChannel({ type: "PLAYBACK_COMMAND", command: "previous" });
        } else {
            originalPlayPrevious.apply(this, arguments);
        }
    };

    // Intercept Volume Adjustments
    const originalSetVolume = Music.SetVolume;
    Music.SetVolume = function(volume: number) {
        if (isSyncEnabled() && isVolumeSyncEnabled()) {
            postToChannel({ type: "PLAYBACK_COMMAND", command: "volume", value: volume });
            if (currentTrackState) {
                currentTrackState.volume_percent = volume;
            }
            syncStateToSteamUI();
        } else {
            originalSetVolume.apply(this, arguments);
        }
    };

    // Intercept Seek Actions
    const originalSetPlaybackPosition = Music.SetPlaybackPosition;
    Music.SetPlaybackPosition = function(seconds: number) {
        if (isSyncEnabled()) {
            const ms = seconds * 1000;
            postToChannel({ type: "PLAYBACK_COMMAND", command: "seek", value: ms });
            if (currentTrackState) {
                currentTrackState.progress_ms = ms;
            }
            syncStateToSteamUI();
        } else {
            originalSetPlaybackPosition.apply(this, arguments);
        }
    };
}

export function hookNativeObservers() {
    const Music = (window as any).SteamClient?.Music;
    if (!Music) return;

    // Capture playback changes observer callbacks
    const originalRegisterChanges = Music.RegisterForMusicPlaybackChanges;
    Music.RegisterForMusicPlaybackChanges = function(callback: any) {
        nativePlaybackCallbacks.add(callback);
        
        if (isSyncEnabled() && currentTrackState) {
            callback(getMockMusicTrack());
        }

        const unregisterObj = originalRegisterChanges.apply(this, arguments);
        return {
            unregister: () => {
                nativePlaybackCallbacks.delete(callback);
                unregisterObj?.unregister();
            }
        };
    };

    // Capture playback position observer callbacks
    const originalRegisterPosition = Music.RegisterForMusicPlaybackPosition;
    Music.RegisterForMusicPlaybackPosition = function(callback: any) {
        nativePositionCallbacks.add(callback);

        if (isSyncEnabled() && currentTrackState) {
            callback(Math.floor((currentTrackState.progress_ms || 0) / 1000));
        }

        const unregisterObj = originalRegisterPosition.apply(this, arguments);
        return {
            unregister: () => {
                nativePositionCallbacks.delete(callback);
                unregisterObj?.unregister();
            }
        };
    };
}
