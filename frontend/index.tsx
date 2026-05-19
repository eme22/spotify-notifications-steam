import { hookNativeControls, hookNativeObservers } from "./src/hooks/nativeHooks";
import { startMonitoring, stopMonitoring, sendPlaybackCommand, channel } from "./src/services/monitoring";
import { currentTrackState } from "./src/services/state";
import { startOverlayPolling } from "./src/components/SpotifyMiniPlayer";
import { SpotifySettingsIcon, NativeSettingsPanel } from "./src/components/NativeSettingsPanel";
import { console } from "./src/utils/logger";

// Satisfy TypeScript compiler for JSX elements in custom bundling contexts
declare global {
    namespace JSX {
        interface IntrinsicElements {
            [elemName: string]: any;
        }
    }
}

// Frontend plugin entry point
export default async function PluginMain() {
    console.debug(`[Spotify Notifications] Frontend loaded in window: "${document.title}"`);
    
    const isBackground = document.title === "SharedJSContext";

    if (isBackground) {
        // SharedJSContext: Runs ONLY the background socket connection & monitoring loop
        
        // Listen for playback commands and initial state requests from overlay
        channel.addEventListener("message", (e) => {
            console.log(`[Spotify Notifications Backend] Received BroadcastChannel message:`, e.data);
            if (e.data.type === "PLAYBACK_COMMAND") {
                console.log(`[Spotify Notifications Backend] Processing PLAYBACK_COMMAND: ${e.data.command} with value:`, e.data.value);
                sendPlaybackCommand(e.data.command, e.data.value);
            } else if (e.data.type === "REQUEST_INITIAL_STATE") {
                console.log(`[Spotify Notifications Backend] Sending initial track state to new window`);
                if (currentTrackState) {
                    channel.postMessage({ type: "TRACK_UPDATE", track: currentTrackState });
                }
            } else if (e.data.type === "SETTINGS_UPDATED") {
                console.log("Settings updated in another window. Restarting monitoring in Main...");
                stopMonitoring();
                startMonitoring();
            }
        });

        // Start active monitoring loop
        startMonitoring();

        // Start polling for overlay window in the shared context
        startOverlayPolling();
    } else {
        // UI Windows (Steam Client UI, etc.)
        
        // Intercept native playback control functions & changes
        hookNativeControls();
        hookNativeObservers();
    }

    // Register our plugin settings natively in Steam client Settings page
    return {
        title: "Spotify Notifications",
        icon: <SpotifySettingsIcon />,
        content: <NativeSettingsPanel />
    };
}
