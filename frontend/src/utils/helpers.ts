// Robust check to identify if current window context is the Game Overlay
export const isOverlayWindow = (): boolean => {
    const title = (document.title || "").toLowerCase();
    const url = (window.location.href || "").toLowerCase();
    return title.includes("overlay") || url.includes("overlay");
};

// Formats milliseconds into M:SS format
export const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};
