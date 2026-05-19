// Custom console wrapper to automatically prefix all logs with plugin name
export const console = {
    log: (...args: any[]) => window.console.log("[Spotify Notifications]", ...args),
    warn: (...args: any[]) => window.console.warn("[Spotify Notifications]", ...args),
    error: (...args: any[]) => window.console.error("[Spotify Notifications]", ...args),
    debug: (...args: any[]) => window.console.debug("[Spotify Notifications]", ...args),
};
