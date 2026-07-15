import { hookNativeControls, hookNativeObservers } from "./src/hooks/nativeHooks";
import { startMonitoring, stopMonitoring, sendPlaybackCommand, listenToChannel, postToChannel } from "./src/services/monitoring";
import { currentTrackState } from "./src/services/state";
import { startOverlayPolling } from "./src/components/SpotifyMiniPlayer";
import { SpotifySettingsIcon, NativeSettingsPanel } from "./src/components/NativeSettingsPanel";
import { console } from "./src/utils/logger";
import { initializeLocalization, t } from "./src/utils/localization";

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
    // Detect and initialize Steam Client language
    const language = await (window as any).SteamClient?.Settings?.GetCurrentLanguage?.() || "english";
    initializeLocalization(language);

    console.debug(`Frontend loaded in window: "${document.title}" with language: "${language}"`);
    const isBackground = document.title === "SharedJSContext";

    if (isBackground) {
        // SharedJSContext: Runs ONLY the background socket connection & monitoring loop

        // Listen for playback commands and initial state requests from overlay
        listenToChannel((e) => {
            console.debug(`Received BroadcastChannel message:`, e.data);
            if (e.data.type === "PLAYBACK_COMMAND") {
                console.debug(`Processing PLAYBACK_COMMAND: ${e.data.command} with value:`, e.data.value);
                sendPlaybackCommand(e.data.command, e.data.value);
            } else if (e.data.type === "REQUEST_INITIAL_STATE") {
                console.debug(`Sending initial track state to new window`);
                if (currentTrackState) {
                    postToChannel({ type: "TRACK_UPDATE", track: currentTrackState });
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
        title: t("pluginTitle"),
        icon: <SpotifySettingsIcon />,
        content: <NativeSettingsPanel />
    };
}
