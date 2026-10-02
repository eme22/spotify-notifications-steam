import { io, Socket } from "socket.io-client";
import { STORAGE_KEYS } from "../constants/keys";
import { console } from "../utils/logger";
import { SpotifyNotifications } from "./notifications";
import { updateTrackState } from "./state";
import { callable } from "@steambrew/client";
import { t } from "../utils/localization";
import { isTokenExpired, refreshAccessToken } from "./auth";

const getDaemonPort = callable<[], string>("get_daemon_port");
const getDaemonToken = callable<[], string>("get_daemon_token");

let cachedDaemonPort: string | null = null;

async function getOrFetchDaemonPort(): Promise<string> {
    if (cachedDaemonPort && cachedDaemonPort !== "0") {
        return cachedDaemonPort;
    }
    try {
        const raw = await getDaemonPort();
        // Same wrapper concern as the token: keep only digits so a quoted value cannot end up
        // embedded in the URL or silently fail the "0" sentinel comparison.
        const digits = (raw || "").trim().match(/\d+/);
        cachedDaemonPort = digits ? digits[0] : "0";
        if (!cachedDaemonPort || cachedDaemonPort === "0") {
            cachedDaemonPort = "0";
        }
    } catch (e) {
        console.error("Failed to call get_daemon_port RPC:", e);
        cachedDaemonPort = "0";
    }
    return cachedDaemonPort || "0";
}

// The daemon rejects requests that lack this header, so it is mandatory on every call.
// It is a per-boot hex secret handed over by the Lua backend; see backend/main.lua.
const DAEMON_TOKEN_HEADER = "x-mediadaemon-token";

// Diagnostics that fire from a 1.5s poll are throttled to once per session.
let warnedAboutWrapper = false;
let warnedAbout403 = false;

async function daemonHeaders(): Promise<Record<string, string>> {
    let raw = "";
    try {
        raw = await getDaemonToken();
    } catch (e) {
        console.error("Failed to call get_daemon_token RPC:", e);
        return {};
    }

    if (!raw) {
        console.error(
            "get_daemon_token returned an empty string. The Lua backend has no token, so the " +
            "daemon will reject us with 403. This means the port.txt handshake did not complete."
        );
        return {};
    }

    // The daemon compares this value byte for byte, so any wrapper the RPC layer adds around the
    // string (quoting, whitespace) makes an otherwise valid token fail with 403. Observed as a
    // 66-character value for a 64-character hex token, i.e. one quote either side.
    // Accept the value only if a well-formed hex token is present inside it.
    const match = raw.trim().match(/[0-9a-f]{64}/);
    if (!match) {
        console.error(
            `Daemon token is not a 64-char hex string (length ${raw.length}, starts with ` +
            `${JSON.stringify(raw.slice(0, 8))}). It will be rejected with 403.`
        );
        return {};
    }

    const token = match[0];
    if (token !== raw.trim() && !warnedAboutWrapper) {
        warnedAboutWrapper = true;
        console.warn(
            `The backend supplied the daemon token wrapped in extra characters ` +
            `(${raw.length - token.length} stripped). Handled automatically.`
        );
    }

    return { [DAEMON_TOKEN_HEADER]: token };
}

const getMimeTypeFromBase64 = (base64Str: string): string => {
    if (!base64Str) return "image/jpeg";
    const firstChars = base64Str.substring(0, 16);
    if (firstChars.startsWith("iVBORw0KGgo")) {
        return "image/png";
    } else if (firstChars.startsWith("/9j/")) {
        return "image/jpeg";
    } else if (firstChars.startsWith("R0lGOD")) {
        return "image/gif";
    } else if (firstChars.startsWith("UklGR")) {
        return "image/webp";
    }
    return "image/jpeg";
};



// Global runtime variables for monitoring
let lastTrackId: string | null = null;
let lastNotificationTime = 0;
let monitoringTimer: any = null;
let activeSocket: Socket | null = null;

// Auto-fallback and hot recovery variables
export let isUsingLocalAPI = false;
let fallbackTimer: any = null;

// BroadcastChannel wrappers for reliable cross-window and same-context communication
export function postToChannel(message: any) {
    const sender = new BroadcastChannel("spotify_notifications_steam");
    sender.postMessage(message);
    sender.close();
}

export function listenToChannel(callback: (e: MessageEvent) => void) {
    const receiver = new BroadcastChannel("spotify_notifications_steam");
    const listener = (e: MessageEvent) => {
        callback(e);
    };
    receiver.addEventListener("message", listener);
    return () => {
        receiver.removeEventListener("message", listener);
        receiver.close();
    };
}

export { isTokenExpired };

// Spotify monitoring loop implementation
export async function startMonitoring() {
    if (activeSocket) {
        activeSocket.removeAllListeners();
        activeSocket.disconnect();
        activeSocket = null;
    }
    if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
    }
    if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
    }

    const mode = localStorage.getItem(STORAGE_KEYS.MODE) || "winmedia";
    const playSound = localStorage.getItem(STORAGE_KEYS.PLAY_SOUND) === "true";
    const minNotificationInterval = parseFloat(localStorage.getItem(STORAGE_KEYS.MIN_INTERVAL) || "2.0");
    const disableNotifications = localStorage.getItem(STORAGE_KEYS.DISABLE_NOTIFICATIONS) === "true";

    if (mode === "winmedia") {
        isUsingLocalAPI = false;
        
        const pollWinMedia = async () => {
            try {
                const port = await getOrFetchDaemonPort();
                if (port === "0") {
                    updateTrackState(null);
                    postToChannel({ type: "TRACK_UPDATE", track: null });
                    return;
                }

                const response = await fetch(`http://127.0.0.1:${port}/state`, {
                    headers: await daemonHeaders()
                });
                if (!response.ok) {
                    if (response.status === 403 && !warnedAbout403) {
                        // The daemon rejects requests whose token does not match its own. That
                        // happens when the daemon was respawned without the Lua backend redoing
                        // the port.txt handshake, so the token it is handing out is stale.
                        // Drop the cached port so the next poll re-reads both from Lua.
                        warnedAbout403 = true;
                        console.error(
                            "Daemon rejected the request (403): its token and the one the backend " +
                            "sends differ, so the daemon was restarted without a new handshake. " +
                            "Re-fetching port and token."
                        );
                        cachedDaemonPort = null;
                    } else {
                        console.error(`Daemon returned HTTP ${response.status} for /state`);
                    }
                    updateTrackState(null);
                    postToChannel({ type: "TRACK_UPDATE", track: null });
                    return;
                }

                const rawData = await response.text();
                if (!rawData || rawData.trim() === "null") {
                    updateTrackState(null);
                    postToChannel({ type: "TRACK_UPDATE", track: null });
                    return;
                }
                
                const data = JSON.parse(rawData);
                if (!data || !data.title) {
                    updateTrackState(null);
                    postToChannel({ type: "TRACK_UPDATE", track: null });
                    return;
                }
                
                const isPlaying = data.status === "Playing";
                
                const trackInfo = {
                    name: data.title || "Unknown",
                    artist: data.artist || "Unknown Artist",
                    album: data.album || "Unknown Album",
                    image_url: data.image ? `data:${getMimeTypeFromBase64(data.image)};base64,${data.image}` : "",
                    id: `${data.artist}:${data.title}`,
                    duration_ms: data.duration || 0,
                    progress_ms: data.progress || 0,
                    is_playing: isPlaying,
                    is_paused: !isPlaying,
                    is_stopped: false,
                    shuffle_state: false,
                    repeat_state: "off",
                    timestamp: Date.now()
                };
                
                updateTrackState(trackInfo);
                postToChannel({ type: "TRACK_UPDATE", track: trackInfo });
                
                if (isPlaying) {
                    const now = Date.now();
                    if (trackInfo.id !== lastTrackId) {
                        if (now - lastNotificationTime >= minNotificationInterval * 1000) {
                            lastTrackId = trackInfo.id;
                            lastNotificationTime = now;
                            if (!disableNotifications) {
                                SpotifyNotifications.sendNotification(t("nowPlaying"), trackInfo.image_url, trackInfo.name, trackInfo.artist, trackInfo.album, playSound);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error polling Windows Media API:", err);
                cachedDaemonPort = null;
            }
        };

        pollWinMedia();
        monitoringTimer = setInterval(pollWinMedia, 1500);
        return;
    }


    // Local WebSocket logic
    const host = localStorage.getItem(STORAGE_KEYS.HOST) || "127.0.0.1";
    const port = localStorage.getItem(STORAGE_KEYS.PORT) || "8443";

    // Spotify Web API logic
    const clientId = localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || "";
    const intervalSec = parseFloat(localStorage.getItem(STORAGE_KEYS.POLLING_INTERVAL) || "2.0");

    const processCurrentlyPlaying = (data: any) => {
        if (!data || !data.item) {
            updateTrackState(null);
            postToChannel({ type: "TRACK_UPDATE", track: null });
            return;
        }
        
        const track = data.item;
        const trackInfo = {
            name: track.name || "Unknown",
            artist: track.artists?.map((a: any) => a.name).join(", ") || "Unknown",
            album: track.album?.name || "Unknown",
            image_url: track.album?.images?.[0]?.url || "",
            id: track.id || track.name || "",
            duration_ms: track.duration_ms || 0,
            progress_ms: data.progress_ms || 0,
            is_playing: data.is_playing ?? false,
            is_paused: data.is_playing === false,
            is_stopped: false,
            shuffle_state: data.shuffle_state ?? false,
            repeat_state: data.repeat_state ?? "off",
            timestamp: Date.now()
        };

        // Update global track state and broadcast
        updateTrackState(trackInfo);
        postToChannel({ type: "TRACK_UPDATE", track: trackInfo });

        if (data.is_playing) {
            const now = Date.now();
            if (trackInfo.id !== lastTrackId) {
                if (now - lastNotificationTime >= minNotificationInterval * 1000) {
                    lastTrackId = trackInfo.id;
                    lastNotificationTime = now;
                    if (!disableNotifications) {
                        SpotifyNotifications.sendNotification(t("nowPlaying"), trackInfo.image_url, trackInfo.name, trackInfo.artist, trackInfo.album, playSound);
                    }
                }
            }
        }
    };

    const pollLoop = async () => {
        try {
            let token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
            const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);

            if (!token) return;

            // Auto-refresh token if expired
            if (isTokenExpired() && refreshToken) {
                console.log("Access token expired. Refreshing...");
                token = (await refreshAccessToken(clientId, refreshToken)).accessToken;
            }

            const response = await fetch("https://api.spotify.com/v1/me/player", {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.status === 401 && refreshToken) {
                // Force refresh token on unauthorized and retry once
                token = (await refreshAccessToken(clientId, refreshToken)).accessToken;
                const retryResponse = await fetch("https://api.spotify.com/v1/me/player", {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                });
                
                if (retryResponse.status === 200) {
                    processCurrentlyPlaying(await retryResponse.json());
                }
                return;
            }

            if (response.status === 200) {
                processCurrentlyPlaying(await response.json());
            } else if (response.status === 204) {
                // No active track playing
                updateTrackState(null);
                postToChannel({ type: "TRACK_UPDATE", track: null });
            }
        } catch (err) {
            console.error("Error polling Spotify Web API:", err);
        }
    };

    const startWebAPIFallback = () => {
        if (mode === "playback") {
            // Only fall back if in playback mode and Web API credentials are set
            if (!clientId || !localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)) {
                console.warn("Local API not responding, but official Spotify Web API is not configured.");
                return;
            }
            console.log("Local API not responding. Activating Spotify Web API Fallback...");
        } else {
            console.log("Starting official Spotify Web API polling...");
        }

        if (monitoringTimer) {
            clearInterval(monitoringTimer);
        }
        
        pollLoop();
        monitoringTimer = setInterval(pollLoop, intervalSec * 1000);
    };

    const stopWebAPIFallback = () => {
        if (monitoringTimer) {
            console.log("Stopping official Spotify Web API polling loop (switching to local)...");
            clearInterval(monitoringTimer);
            monitoringTimer = null;
        }
    };

    if (mode === "webapi") {
        isUsingLocalAPI = false;
        startWebAPIFallback();
        return;
    }

    // Otherwise, we are in "playback" mode (which has automatic fallback)
    console.log(`Starting Playback API WebSocket connection to ws://${host}:${port}...`);

    isUsingLocalAPI = false; // Default to false until we successfully connect

    activeSocket = io(`http://${host}:${port}`, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 5000,
    });

    // Start 4-second timeout to activate fallback if connection isn't established quickly
    fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!isUsingLocalAPI) {
            startWebAPIFallback();
        }
    }, 4000);

    activeSocket.on("connect", () => {
        console.log("WebSocket connected to Spotify Playback API!");
        isUsingLocalAPI = true;
        
        if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }

        // Suspend polling loop since we are using local connection
        stopWebAPIFallback();

        // Start active local periodic query to get playback state updates
        if (monitoringTimer) {
            clearInterval(monitoringTimer);
        }
        
        console.debug("Starting local periodic query loop (every 2.0s)...");
        activeSocket?.emit("getdata");
        monitoringTimer = setInterval(() => {
            if (activeSocket && activeSocket.connected) {
                activeSocket.emit("getdata");
            }
        }, 2000);
    });

    activeSocket.on("connect_error", (error) => {
        console.warn("WebSocket connection error to Playback API:", error.message);
        if (isUsingLocalAPI) {
            isUsingLocalAPI = false;
            startWebAPIFallback();
        }
    });

    activeSocket.on("player_data", (data) => {
        console.debug("Received local player_data payload:", data);
        
        if (!data || !data.track || data.track === "No track info yet") {
            console.debug("Empty or uninitialized player_data received.");
            updateTrackState(null);
            postToChannel({ type: "TRACK_UPDATE", track: null });
            return;
        }
        const track = data.track;
        
        let trackInfo: any = null;
        if (typeof track === "string") {
            let isPlaying = true;
            if (data.is_playing !== undefined && data.is_playing !== null) {
                isPlaying = data.is_playing;
            } else if (data.is_paused === true || data.is_stopped === true) {
                isPlaying = false;
            }

            let repeatVal = "off";
            if (data.repeat_mode !== undefined && data.repeat_mode !== null) {
                if (data.repeat_mode === 1) {
                    repeatVal = "context";
                } else if (data.repeat_mode === 2) {
                    repeatVal = "track";
                } else {
                    repeatVal = "off";
                }
            } else {
                const rawRepeat = data.repeat ?? data.repeat_state ?? "off";
                if (typeof rawRepeat === "boolean") {
                    repeatVal = rawRepeat ? "context" : "off";
                } else if (typeof rawRepeat === "string") {
                    repeatVal = rawRepeat;
                }
            }

            let isPaused = data.is_paused === true;
            let isStopped = data.is_stopped === true;

            trackInfo = {
                name: track,
                artist: "Unknown Artist",
                album: "Unknown Album",
                image_url: "",
                id: track,
                duration_ms: data.duration_ms || data.duration || 0,
                progress_ms: data.progress_ms ?? data.progress ?? 0,
                is_playing: isPlaying && !isPaused && !isStopped,
                is_paused: isPaused,
                is_stopped: isStopped,
                shuffle_state: data.shuffle_active ?? data.shuffle ?? data.shuffle_state ?? false,
                repeat_state: repeatVal,
                timestamp: Date.now()
            };
        } else if (typeof track === "object") {
            let isPlaying = true;
            if (data.is_playing !== undefined && data.is_playing !== null) {
                isPlaying = data.is_playing;
            } else if (data.is_paused === true || data.is_stopped === true) {
                isPlaying = false;
            } else if (track.is_playing !== undefined && track.is_playing !== null) {
                isPlaying = track.is_playing;
            }

            let isPaused = data.is_paused === true || track.is_paused === true;
            let isStopped = data.is_stopped === true || track.is_stopped === true;

            let repeatVal = "off";
            if (data.repeat_mode !== undefined && data.repeat_mode !== null) {
                if (data.repeat_mode === 1) {
                    repeatVal = "context";
                } else if (data.repeat_mode === 2) {
                    repeatVal = "track";
                } else {
                    repeatVal = "off";
                }
            } else {
                const rawRepeat = track.repeat ?? data.repeat ?? track.repeat_state ?? data.repeat_state ?? "off";
                if (typeof rawRepeat === "boolean") {
                    repeatVal = rawRepeat ? "context" : "off";
                } else if (typeof rawRepeat === "string") {
                    repeatVal = rawRepeat;
                }
            }

            trackInfo = {
                name: track.name || "Unknown",
                artist: track.artist || "Unknown",
                album: track.album || "Unknown",
                image_url: track.image_url || "",
                id: track.id || track.name || "",
                duration_ms: track.duration_ms || data.duration_ms || data.duration || 0,
                progress_ms: track.progress_ms ?? data.progress_ms ?? track.progress ?? data.progress ?? 0,
                is_playing: isPlaying && !isPaused && !isStopped,
                is_paused: isPaused,
                is_stopped: isStopped,
                shuffle_state: data.shuffle_active ?? track.shuffle ?? data.shuffle ?? track.shuffle_state ?? data.shuffle_state ?? false,
                repeat_state: repeatVal,
                timestamp: Date.now()
            };
        }

        if (trackInfo) {
            console.debug("Parsed local trackInfo:", trackInfo);
            
            // Update global track state and broadcast
            updateTrackState(trackInfo);
            postToChannel({ type: "TRACK_UPDATE", track: trackInfo });

            const now = Date.now();
            console.debug(`Checking notification condition: trackInfo.id="${trackInfo.id}" vs lastTrackId="${lastTrackId}", is_playing=${trackInfo.is_playing}`);
            
            if (trackInfo.id !== lastTrackId && trackInfo.is_playing && !trackInfo.is_paused && !trackInfo.is_stopped) {
                const timeDiff = now - lastNotificationTime;
                const requiredDiff = minNotificationInterval * 1000;
                console.debug(`Notification trigger check: timeDiff=${timeDiff}ms vs requiredDiff=${requiredDiff}ms`);
                
                if (timeDiff >= requiredDiff) {
                    console.debug(`Triggering 'Now Playing' notification for track: ${trackInfo.name}`);
                    lastTrackId = trackInfo.id;
                    lastNotificationTime = now;
                    if (!disableNotifications) {
                        SpotifyNotifications.sendNotification(t("nowPlaying"), trackInfo.image_url, trackInfo.name, trackInfo.artist, trackInfo.album, playSound);
                    }
                } else {
                    console.warn(`Notification skipped (throttled): timeDiff=${timeDiff}ms is less than required ${requiredDiff}ms.`);
                }
            }
        }
    });

    activeSocket.on("disconnect", () => {
        console.warn("WebSocket disconnected from Playback API. Starting grace period...");
        
        // Wait 4 seconds to see if it auto-reconnects, otherwise fall back to Spotify Web API
        if (fallbackTimer) {
            clearTimeout(fallbackTimer);
        }
        
        fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            if (activeSocket && !activeSocket.connected) {
                isUsingLocalAPI = false;
                startWebAPIFallback();
            }
        }, 4000);
    });
}

// Stop all live monitoring activities
export function stopMonitoring() {
    if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
    }
    if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
    }
    if (activeSocket) {
        activeSocket.removeAllListeners();
        activeSocket.disconnect();
        activeSocket = null;
    }
    isUsingLocalAPI = false;
    lastTrackId = null;
    lastNotificationTime = 0;
    cachedDaemonPort = null;
    // A monitoring restart is a fresh start: allow the 403 diagnostic to fire again if the
    // daemon is out of sync with the backend after this point.
    warnedAbout403 = false;
    console.log("Spotify monitoring halted.");
}

// Send playback commands to Spotify (local API or official Spotify Web API)
export async function sendPlaybackCommand(command: "play" | "pause" | "next" | "previous" | "volume" | "seek" | "shuffle" | "repeat", value?: any) {
    console.log(`[Spotify Notifications API] sendPlaybackCommand invoked: command=${command}, value=${value}, isUsingLocalAPI=${isUsingLocalAPI}`);
    
    const mode = localStorage.getItem(STORAGE_KEYS.MODE) || "winmedia";
    if (mode === "winmedia") {
        console.log(`[Spotify Notifications API] Windows Media Mode - command=${command}`);
        if (command === "play" || command === "pause" || command === "next" || command === "previous") {
            try {
                const port = await getOrFetchDaemonPort();
                if (port !== "0") {
                    const res = await fetch(`http://127.0.0.1:${port}/command?cmd=${command}`, {
                        method: "POST",
                        headers: await daemonHeaders()
                    });
                    console.log(`[Spotify Notifications API] Windows Media command result status: ${res.status}`);
                } else {
                    console.error("[Spotify Notifications API] Daemon port not initialized!");
                }
            } catch (err) {
                console.error("[Spotify Notifications API] Failed to send Windows Media command:", err);
                cachedDaemonPort = null;
            }
        } else {
            console.warn(`[Spotify Notifications API] Command ${command} not supported in Windows Media Mode`);
        }
        return;
    }

    if (isUsingLocalAPI) {
        const host = localStorage.getItem(STORAGE_KEYS.HOST) || "127.0.0.1";
        const port = localStorage.getItem(STORAGE_KEYS.PORT) || "8443";
        
        console.log(`[Spotify Notifications API] Local API Mode - host=${host}, port=${port}`);
        
        let localValue = value;
        if (command === "repeat" && typeof value === "string") {
            if (value === "off") localValue = 0;
            else if (value === "context") localValue = 1;
            else if (value === "track") localValue = 2;
        }

        // 1. Emit to Socket.IO connection
        if (activeSocket) {
            console.log(`[Spotify Notifications API] Socket state: connected=${activeSocket.connected}`);
            if (activeSocket.connected) {
                if (command === "volume" && value !== undefined) {
                    activeSocket.emit("volume", value);
                } else if (command === "seek" && value !== undefined) {
                    activeSocket.emit("seek", value);
                } else if (command === "play" || command === "pause") {
                    activeSocket.emit("PlayPause");
                } else if (command === "next") {
                    activeSocket.emit("Next");
                } else if (command === "previous") {
                    activeSocket.emit("Prev");
                } else if (command === "shuffle") {
                    activeSocket.emit("Shuffle", value);
                } else if (command === "repeat") {
                    activeSocket.emit("Repeat", localValue);
                } else {
                    activeSocket.emit(command, value);
                }
                console.log(`[Spotify Notifications API] Socket.IO event emitted for command: ${command}`);
                return;
            }
        }
        
        // 2. Fetch local endpoints as secondary fallback
        try {
            let localUrl = "";
            if (command === "volume" && value !== undefined) {
                localUrl = `http://${host}:${port}/volume?value=${value}`;
            } else if (command === "seek" && value !== undefined) {
                localUrl = `http://${host}:${port}/seek?value=${value}`;
            } else if (command === "shuffle" && value !== undefined) {
                localUrl = `http://${host}:${port}/shuffle?state=${value}`;
            } else if (command === "repeat" && value !== undefined) {
                localUrl = `http://${host}:${port}/repeat?state=${localValue}`;
            } else {
                const endpointMap: Record<string, string> = {
                    play: "PlayPause",
                    pause: "PlayPause",
                    next: "Next",
                    previous: "Prev",
                    shuffle: "Shuffle",
                    repeat: "Repeat"
                };
                const endpoint = endpointMap[command as string] || command;
                localUrl = `http://${host}:${port}/${endpoint}`;
            }
            console.log(`[Spotify Notifications API] Fetching local fallback URL: ${localUrl}`);
            await fetch(localUrl, { method: "POST", mode: "no-cors" });
            console.log(`[Spotify Notifications API] Local fallback fetch completed`);
        } catch (e: any) {
            console.error(`[Spotify Notifications API] Local fallback fetch error:`, e.message);
        }
    } else {
        // Web API Mode
        const clientId = localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || "";
        const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
        let token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);

        console.log(`[Spotify Notifications API] Web API Mode - tokenExists=${!!token}, refreshTokenExists=${!!refreshToken}`);

        if (!token) {
            console.warn(`[Spotify Notifications API] Cannot execute command - missing Spotify access token!`);
            return;
        }

        if (isTokenExpired() && refreshToken) {
            try {
                console.log(`[Spotify Notifications API] Access token expired. Refreshing before command...`);
                token = (await refreshAccessToken(clientId, refreshToken)).accessToken;
            } catch (err) {
                console.error("[Spotify Notifications API] Token refresh failed in playback command:", err);
                return;
            }
        }

        const urlMap = {
            play: "play",
            pause: "pause",
            next: "next",
            previous: "previous",
            volume: "volume",
            seek: "seek",
            shuffle: "shuffle",
            repeat: "repeat"
        };
        
        let url = `https://api.spotify.com/v1/me/player/${urlMap[command as keyof typeof urlMap]}`;
        if (command === "volume" && value !== undefined) {
            url += `?volume_percent=${value}`;
        } else if (command === "seek" && value !== undefined) {
            url += `?position_ms=${value}`;
        } else if (command === "shuffle" && value !== undefined) {
            url += `?state=${value}`;
        } else if (command === "repeat" && value !== undefined) {
            url += `?state=${value}`;
        }
        const method = command === "play" || command === "pause" || command === "volume" || command === "seek" || command === "shuffle" || command === "repeat" ? "PUT" : "POST";
        
        console.log(`[Spotify Notifications API] Sending request to Spotify Web API: ${method} ${url}`);
        
        try {
            const res = await fetch(url, {
                method: method,
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            });
            console.log(`[Spotify Notifications API] Spotify Web API response status: ${res.status}`);
            if (!res.ok) {
                const errText = await res.text();
                console.error(`[Spotify Notifications API] Spotify Web API command failed! Status: ${res.status}, Body: ${errText}`);
            }
        } catch (err: any) {
            console.error("[Spotify Notifications API] Failed to execute Spotify Web API command:", err.message);
        }
    }
}
