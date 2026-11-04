import { STORAGE_KEYS } from "../constants/keys";
import { console } from "../utils/logger";

export type NotificationWhen = "always" | "steam" | "steam_or_game" | "game" | "none";

const NOTIFICATION_WHEN_VALUES: NotificationWhen[] = [
    "always",
    "steam",
    "steam_or_game",
    "game",
    "none"
];

export function isNotificationWhen(value: string | null): value is NotificationWhen {
    return value !== null && (NOTIFICATION_WHEN_VALUES as string[]).includes(value);
}

/** The selected mode, with the old on/off toggle migrated to `none`. */
export function getNotificationWhen(): NotificationWhen {
    const stored = localStorage.getItem(STORAGE_KEYS.NOTIFICATION_WHEN);
    if (isNotificationWhen(stored)) return stored;

    return localStorage.getItem(STORAGE_KEYS.DISABLE_NOTIFICATIONS) === "true" ? "none" : "always";
}

export function needsGameDetection(when: NotificationWhen): boolean {
    return when === "game" || when === "steam_or_game";
}

export function needsSteamDetection(when: NotificationWhen): boolean {
    return when === "steam" || when === "steam_or_game";
}

interface Unregisterable {
    unregister?: () => void;
}

let gameTracker: Unregisterable | null = null;
let runningInstances = new Set<number>();
let registryInGame = false;
let registryKnown = false;
let steamForeground = false;
let foregroundKnown = false;

/**
 * Forgets every detector result.
 *
 * A monitoring restart may switch modes, so stale answers from the previous mode must not decide
 * the first notification of the new one.
 */
export function resetGameState() {
    runningInstances = new Set<number>();
    registryInGame = false;
    registryKnown = false;
    steamForeground = false;
    foregroundKnown = false;
}

/**
 * Live game tracking through Steam's own app lifetime events.
 *
 * This catches non-Steam shortcuts, which the registry does not report. It is only subscribed in
 * modes that need game detection; `stopGameTracking` unsubscribes when the mode changes.
 */
export function startGameTracking() {
    if (gameTracker) return;

    const gameSessions = (window as any).SteamClient?.GameSessions;
    if (!gameSessions?.RegisterForAppLifetimeNotifications) {
        console.warn(
            "[Spotify Notifications] SteamClient.GameSessions is unavailable; game detection " +
            "will rely on the daemon registry."
        );
        return;
    }

    try {
        gameTracker = gameSessions.RegisterForAppLifetimeNotifications((notification: any) => {
            // Instance IDs distinguish multiple running apps; `unAppID` is 0 for non-Steam
            // shortcuts, so it cannot be used as the key on its own.
            const instance = Number(notification?.nInstanceID ?? notification?.unAppID ?? 0);
            if (!instance) return;

            if (notification?.bRunning) {
                runningInstances.add(instance);
            } else {
                runningInstances.delete(instance);
            }
        });
    } catch (err) {
        console.error("[Spotify Notifications] Failed to subscribe to Steam app lifetime notifications:", err);
    }
}

export function stopGameTracking() {
    try {
        gameTracker?.unregister?.();
    } catch (err) {
        console.error("[Spotify Notifications] Failed to unsubscribe from Steam app lifetime notifications:", err);
    }
    gameTracker = null;
    runningInstances = new Set<number>();
}

export function setRegistryInGame(value: boolean) {
    registryInGame = value;
    registryKnown = true;
}

export function setSteamForeground(value: boolean) {
    steamForeground = value;
    foregroundKnown = true;
}

function hasRunningGame(): boolean {
    return runningInstances.size > 0 || registryInGame;
}

/**
 * Decides whether a toast may be shown in the selected mode.
 *
 * Detectors fail open: until the first answer arrives (or if the daemon is unreachable), the
 * notification is allowed rather than silently dropped.
 */
export function shouldNotify(when: NotificationWhen): boolean {
    switch (when) {
        case "none":
            return false;
        case "always":
            return true;
        case "steam":
            return !foregroundKnown || steamForeground;
        case "game":
            return !registryKnown || hasRunningGame();
        case "steam_or_game":
            return (!foregroundKnown || steamForeground) || (!registryKnown || hasRunningGame());
        default:
            return true;
    }
}
