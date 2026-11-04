import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { postToChannel, listenToChannel, getPinnedSession, selectSession } from "../services/monitoring";
import { currentTrackState, onTrackChange } from "../services/state";
import { STORAGE_KEYS } from "../constants/keys";
import { STEAM_PLAYER, cn, hasSteamPlayerClasses } from "../constants/steamClasses";
import { formatTime } from "../utils/helpers";
import { console } from "../utils/logger";
import { t } from "../utils/localization";
import { Dropdown } from "@steambrew/client";

// Re-anchoring thresholds for the seek bar. Deliberately asymmetric.
const FORWARD_RESYNC_TOLERANCE_MS = 2500;
const BACKWARD_RESYNC_TOLERANCE_MS = 5000;

export const SpotifyMiniPlayer: React.FC = () => {
    const [track, setTrack] = useState<any>(currentTrackState);
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.PLAYER_COLLAPSED) !== "false");
    const [sessions, setSessions] = useState<any[]>([]);
    const [pinned, setPinned] = useState<string>(() => getPinnedSession());
    const [localProgress, setLocalProgress] = useState(0);
    const localProgressRef = useRef<number>(0);

    const updateLocalProgress = (progress: number) => {
        localProgressRef.current = progress;
        setLocalProgress(progress);
    };

    const toggleCollapsed = (collapsed: boolean) => {
        localStorage.setItem(STORAGE_KEYS.PLAYER_COLLAPSED, String(collapsed));
        setIsCollapsed(collapsed);
    };

    useEffect(() => {
        const unsubscribe = onTrackChange((newTrack) => {
            setTrack(newTrack);
        });

        const unsubscribeChannel = listenToChannel((e: MessageEvent) => {
            if (e.data.type === "TRACK_UPDATE") {
                setTrack(e.data.track);
            } else if (e.data.type === "SESSIONS_UPDATE") {
                setSessions(Array.isArray(e.data.sessions) ? e.data.sessions : []);
            }
        });

        const unsubscribeSelection = listenToChannel((e: MessageEvent) => {
            if (e.data.type === "SESSION_SELECTED") {
                setPinned(e.data.session || "");
            }
        });

        console.log(`[Spotify Notifications MiniPlayer] Requesting initial state from backend...`);
        postToChannel({ type: "REQUEST_INITIAL_STATE" });

        return () => {
            unsubscribe();
            unsubscribeChannel();
            unsubscribeSelection();
        };
    }, []);

    // Sync collapsed/expanded across overlay windows (and Steam restarts).
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEYS.PLAYER_COLLAPSED && e.newValue !== null) {
                setIsCollapsed(e.newValue !== "false");
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    // Retry initial state while no track has arrived (covers reopening the overlay).
    useEffect(() => {
        if (track) return undefined;
        const id = setInterval(() => postToChannel({ type: "REQUEST_INITIAL_STATE" }), 2000);
        return () => clearInterval(id);
    }, [track]);

    const handleSelectSession = (sessionId: string) => {
        selectSession(sessionId);
        setPinned(sessionId);
        postToChannel({ type: "SESSION_SELECTED", session: sessionId });
    };

    const pinnedIsUsable = !!pinned && sessions.some(session => session.id === pinned);
    const activeSessionId = pinnedIsUsable ? pinned : (track?.session_id || "");

    const selectableSessions = (() => {
        const list = sessions.filter(session => session.status !== "Stopped" || session.id === activeSessionId);
        if (activeSessionId && !list.some(session => session.id === activeSessionId)) {
            list.unshift({
                id: activeSessionId,
                app: track?.app || "",
                title: track?.name || "",
                artist: track?.artist || "",
                status: track?.is_playing ? "Playing" : "Paused"
            });
        }
        return list;
    })();

    useEffect(() => {
        if (!pinned || sessions.length === 0) return;
        if (sessions.some(session => session.id === pinned)) return;

        console.log(`[Spotify MiniPlayer] Pinned session ${pinned} disappeared, following the active one`);
        selectSession("");
        setPinned("");
        postToChannel({ type: "SESSION_SELECTED", session: "" });
    }, [sessions, pinned]);

    const baselineTrackIdRef = useRef<string | null>(null);
    const baselineProgressRef = useRef<number>(0);
    const baselineTimeRef = useRef<number>(0);
    const baselineIsPlayingRef = useRef<boolean>(false);

    useEffect(() => {
        if (!track) {
            baselineTrackIdRef.current = null;
            baselineProgressRef.current = 0;
            baselineTimeRef.current = 0;
            baselineIsPlayingRef.current = false;
            updateLocalProgress(0);
            return;
        }

        const currentTrackId = track.id;
        const currentProgress = Math.max(0, track.progress_ms || 0);
        const currentTime = Date.now();
        const currentIsPlaying = track.is_playing || false;

        const clampToTrack = (value: number) => {
            const duration = track.duration_ms || 0;
            return duration > 0 ? Math.min(value, duration) : value;
        };

        const reanchor = (progress: number, now: number) => {
            baselineProgressRef.current = progress;
            baselineTimeRef.current = now;
            updateLocalProgress(clampToTrack(progress));
        };

        const isFirstLookup = baselineTrackIdRef.current !== currentTrackId;
        const isPlayStateChanged = baselineIsPlayingRef.current !== currentIsPlaying;

        if (isFirstLookup) {
            baselineTrackIdRef.current = currentTrackId;
            baselineIsPlayingRef.current = currentIsPlaying;
            reanchor(currentProgress, currentTime);
            return;
        }

        if (isPlayStateChanged) {
            baselineTrackIdRef.current = currentTrackId;
            baselineIsPlayingRef.current = currentIsPlaying;
            reanchor(currentProgress, currentTime);
            return;
        }

        if (!currentIsPlaying) {
            if (currentProgress !== baselineProgressRef.current) {
                reanchor(currentProgress, currentTime);
            }
            return;
        }

        const estimatedProgress = baselineProgressRef.current + (currentTime - baselineTimeRef.current);
        const drift = currentProgress - estimatedProgress;

        if (drift > FORWARD_RESYNC_TOLERANCE_MS || drift < -BACKWARD_RESYNC_TOLERANCE_MS) {
            console.log(`[Spotify MiniPlayer] Resyncing to the reported position (drift ${drift}ms): ${currentProgress}ms`);
            reanchor(currentProgress, currentTime);
        }
    }, [track]);

    useEffect(() => {
        if (!track || !track.is_playing) {
            return () => { };
        }

        const interval = setInterval(() => {
            const currentTime = Date.now();
            if (baselineTrackIdRef.current === track.id && baselineTimeRef.current > 0) {
                const elapsed = currentTime - baselineTimeRef.current;
                const estimated = baselineProgressRef.current + elapsed;
                const finalProgress = estimated > track.duration_ms ? track.duration_ms : estimated;
                updateLocalProgress(finalProgress);
            }
        }, 100);

        return () => clearInterval(interval);
    }, [track?.id, track?.is_playing]);

    const handleCommand = (command: "play" | "pause" | "next" | "previous" | "shuffle" | "repeat") => {
        console.log(`[Spotify Notifications MiniPlayer] Button clicked: ${command}`);

        let value: any = undefined;
        if (command === "shuffle") {
            value = !track.shuffle_state;
        } else if (command === "repeat") {
            if (track.repeat_state === "off") {
                value = "context";
            } else if (track.repeat_state === "context") {
                value = "track";
            } else {
                value = "off";
            }
        }

        if (command === "play") {
            setTrack((prev: any) => prev ? { ...prev, is_playing: true } : prev);
        } else if (command === "pause") {
            setTrack((prev: any) => prev ? { ...prev, is_playing: false } : prev);
        }

        postToChannel({ type: "PLAYBACK_COMMAND", command, value });
    };

    useEffect(() => {
        if (!hasSteamPlayerClasses()) {
            console.warn("[Spotify MiniPlayer] Native Steam player classes not found in document stylesheets (Steam build mismatch?).");
        }
    }, []);

    if (!track) return null;

    const progressPercent = track.duration_ms > 0 ? (localProgress / track.duration_ms) * 100 : 0;
    const supportsShuffleRepeat = (localStorage.getItem(STORAGE_KEYS.MODE) || "winmedia") !== "winmedia";
    const isShuffleActive = supportsShuffleRepeat && track.shuffle_state === true;
    const isRepeatActive = supportsShuffleRepeat && (track.repeat_state === "context" || track.repeat_state === "track");
    const repeatTitle = track.repeat_state === "track" ? t("repeatOne") : track.repeat_state === "context" ? t("repeatAll") : t("repeatOff");

    const playerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
        const savedX = localStorage.getItem("spotify_notif_player_x");
        const savedY = localStorage.getItem("spotify_notif_player_y");
        if (savedX !== null && savedY !== null) {
            return { x: parseInt(savedX, 10), y: parseInt(savedY, 10) };
        }
        return null;
    });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isCollapsed) return;
        if (e.button !== 0) return;

        const target = e.target as HTMLElement;
        if (
            target.closest("button") || target.closest("select") ||
            target.closest("option") || target.closest(".window-controls") ||
            target.closest(".player-progress-container") ||
            target.closest(".player-artist") ||
            target.closest(".player-title")
        ) {
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        dragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            posX: rect.left,
            posY: rect.top
        };
        setIsDragging(true);
        e.preventDefault();
    };

    useEffect(() => {
        if (!isDragging) return () => { };

        const handleMouseMove = (e: MouseEvent) => {
            if (!dragStartRef.current) return;

            const deltaX = e.clientX - dragStartRef.current.startX;
            const deltaY = e.clientY - dragStartRef.current.startY;

            let newX = dragStartRef.current.posX + deltaX;
            let newY = dragStartRef.current.posY + deltaY;

            const playerEl = playerRef.current;
            const playerWidth = playerEl?.offsetWidth || 320;
            const playerHeight = playerEl?.offsetHeight || 140;

            const ownerDoc = playerEl?.ownerDocument || document;
            const ownerWindow = ownerDoc.defaultView || window;

            const viewportWidth = ownerWindow.innerWidth;
            const viewportHeight = ownerWindow.innerHeight;

            if (newX < 10) newX = 10;
            if (newX + playerWidth > viewportWidth - 10) newX = viewportWidth - playerWidth - 10;
            if (newY < 10) newY = 10;
            if (newY + playerHeight > viewportHeight - 10) newY = viewportHeight - playerHeight - 10;

            setPosition({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            if (dragStartRef.current) {
                if (position) {
                    localStorage.setItem("spotify_notif_player_x", position.x.toString());
                    localStorage.setItem("spotify_notif_player_y", position.y.toString());
                }
                dragStartRef.current = null;
                setIsDragging(false);
            }
        };

        const playerEl = playerRef.current;
        const ownerDoc = playerEl?.ownerDocument || document;
        const ownerWindow = ownerDoc.defaultView || window;

        ownerWindow.addEventListener("mousemove", handleMouseMove);
        ownerWindow.addEventListener("mouseup", handleMouseUp);

        return () => {
            ownerWindow.removeEventListener("mousemove", handleMouseMove);
            ownerWindow.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, position]);

    const fallbackImage = "https://avatars.steamstatic.com/f1fdf8e7465a06c2b1806a448ef27af283afeb29_medium.jpg";

    return (
        <div
            ref={playerRef}
            className="spotify-player-root"
            onMouseDown={handleMouseDown}
            style={{
                position: "fixed",
                zIndex: 999999,
                userSelect: "none",
                width: isCollapsed ? "auto" : 320,
                cursor: !isCollapsed ? (isDragging ? "grabbing" : "grab") : "default",
                transition: isDragging ? "none" : "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                ...(isCollapsed
                    ? { bottom: "35px", right: "25px", left: "auto", top: "auto" }
                    : (position
                        ? { left: `${position.x}px`, top: `${position.y}px`, bottom: "auto", right: "auto" }
                        : { bottom: "35px", right: "25px", left: "auto", top: "auto" }
                    )
                )
            }}
        >
            <style>{`
                .spotify-player-root { width: 320px; }
                .spotify-player-root .player-avatar-img { width: 48px; height: 48px; object-fit: cover; display: block; border-radius: 4px; }
                .spotify-player-root .player-progress-track { height: 4px; background: hsla(0, 0%, 100%, 0.2); border-radius: 2px; position: relative; overflow: hidden; }
                .spotify-player-root .player-progress-bar { height: 100%; background: hsla(0, 0%, 100%, 0.8); border-radius: 2px; transition: width 0.1s linear; }
                .spotify-player-root .player-durations { display: flex; justify-content: space-between; font-size: 10px; color: hsla(0, 0%, 100%, 0.7); }
                .spotify-player-root .player-session-select { margin-top: 8px; width: 100%; }
                .spotify-player-root .title-area-icon { cursor: pointer; }
                .spotify-player-root .title-area-icon svg { stroke: currentColor; }
                .spotify-player-root .DialogButton svg { width: 18px; height: 18px; display: block; }
                .spotify-player-root .player-play-btn svg { width: 24px; height: 24px; }
                .spotify-player-root .player-progress-track { flex: 1; }
                .spotify-player-root .player-collapsed-btn { display: inline-flex; width: auto; min-width: 0; padding: 4px; line-height: 0; }
                .spotify-player-root .window-controls .title-area-icon { color: inherit; }
                .spotify-player-root .player-session-picker { width: 100%; }
                .spotify-player-root .player-session-picker > * { width: 100%; }
                .spotify-player-root .player-session-picker button { width: 100%; min-width: 0; }
                .spotify-player-root .player-controls-row { width: 100% !important; align-self: stretch !important; justify-content: center !important; }
                .spotify-player-root .player-controls { display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; gap: 8px; }
                .spotify-player-root .player-controls-side { flex: 1 1 0; display: flex; align-items: center; gap: 12px; min-width: 0; }
                .spotify-player-root .player-controls-side.left { justify-content: flex-end; }
                .spotify-player-root .player-controls-side.right { justify-content: flex-start; }
                .spotify-player-root .player-controls-center { flex: 0 0 auto; display: flex; }
                .spotify-player-root .player-controls button { flex: 0 0 36px !important; width: 36px !important; height: 36px !important; min-width: 0 !important; padding: 0 !important; margin: 0 !important; }
                .spotify-player-root .player-controls .player-play-btn { flex: 0 0 44px !important; width: 44px !important; height: 44px !important; }
                .spotify-player-root .player-panel { background: var(--aika-overlay-material, var(--fr-panel, var(--main-background, var(--secondary-background, rgba(30, 37, 51, 0.98))))) !important; border-radius: var(--aika-radius-lg, 8px); overflow: hidden; }
            `}</style>

            {isCollapsed ? (
                <button
                    type="button"
                    className="DialogButton Secondary Focusable player-collapsed-btn"
                    onClick={() => toggleCollapsed(false)}
                    title={t("miniPlayerOpen")}
                >
                    <img className="player-avatar-img" draggable="false" src={track.image_url || fallbackImage} />
                </button>
            ) : (
                <div className={cn(STEAM_PLAYER.overlay, "player-panel")}>
                    {/* Header row: cover, title, artist, close */}
                    <div className={STEAM_PLAYER.currentTrackContainer}>
                        <div className={STEAM_PLAYER.art}>
                            <img src={track.image_url || fallbackImage} />
                        </div>
                        <div className={STEAM_PLAYER.details}>
                            <div className={STEAM_PLAYER.soundtrackName}>{track.artist}</div>
                            <div className={STEAM_PLAYER.trackName}>{track.name}</div>
                        </div>

                        <div className="title-bar-actions window-controls">
                            <div className="title-area-icon closeButton windowControlButton" onClick={() => toggleCollapsed(true)} title={t("miniPlayerMinimize")}>
                                <div className="title-area-icon-inner">
                                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" className="SVGIcon_Button SVGIcon_X_Line" x="0px" y="0px" width="256px" height="256px" viewBox="0 0 256 256">
                                        <line fill="none" stroke="currentColor" strokeWidth="45" strokeMiterlimit="10" x1="212" y1="212" x2="44" y2="44"></line>
                                        <line fill="none" stroke="currentColor" strokeWidth="45" strokeMiterlimit="10" x1="44" y1="212" x2="212" y2="44"></line>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Progress */}
                    <div className={cn(STEAM_PLAYER.controlBlock, STEAM_PLAYER.compactView)}>
                        <div className={cn(STEAM_PLAYER.progress, STEAM_PLAYER.compactView)}>
                            <div className={STEAM_PLAYER.text}>{formatTime(localProgress)}</div>
                            <div className="player-progress-track">
                                <div className="player-progress-bar" style={{ width: `${progressPercent}%` }} />
                            </div>
                            <div className={STEAM_PLAYER.text}>{formatTime(track.duration_ms)}</div>
                        </div>

                        {/* Controls */}
                        <div className={cn(STEAM_PLAYER.controlsAndVolume, STEAM_PLAYER.row, "player-controls-row")}>
                            <div className={cn(STEAM_PLAYER.controls, "player-controls")}>
                                <div className="player-controls-side left">
                                    {supportsShuffleRepeat && (
                                        <button
                                            type="button"
                                            className={cn("DialogButton", STEAM_PLAYER.iconButton, isShuffleActive && STEAM_PLAYER.active)}
                                            onClick={() => handleCommand("shuffle")}
                                            title={isShuffleActive ? t("shuffleOn") : t("shuffleOff")}
                                        >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                            <path fillRule="evenodd" clip-rule="evenodd" d="M2.00023 24.453H4.84442C6.92144 24.453 8.26825 22.9277 9.32331 21.1763L15.3048 11.2448C17.1871 8.11946 19.9271 5.76281 23.5619 5.76281H26.038L26.0379 2L33.9995 8.15498L26.0386 14.3096V10.5472H23.5624C21.5098 10.5472 20.1227 12.0984 19.0835 13.8239L13.1017 23.7561C11.1813 26.9448 8.58909 29.2381 4.84462 29.2381H2.0001L2.00023 24.453ZM2.00023 10.547H4.84442C6.92144 10.547 8.26825 12.0723 9.32331 13.8238L9.86817 14.7281L12.5155 10.3325C10.6604 7.62746 8.22064 5.76215 4.84419 5.76215L2 5.76202L2.00023 10.547ZM26.0384 20.6906V24.453H23.5622C21.5096 24.453 20.1225 22.9018 19.0833 21.1763L18.5385 20.2719L15.8931 24.6641C17.7422 27.3264 20.2893 29.2375 23.5622 29.2375H26.1776L26.0384 33L34 26.8454L26.0384 20.6906Z" fill="currentColor"></path>
                                        </svg>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={cn("DialogButton", STEAM_PLAYER.iconButton)}
                                    onClick={() => handleCommand("previous")}
                                    title={t("prevTrack")}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M32.013 31.27a1 1 0 0 1-1.499.868L10 20.335V30a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9.665L30.514 3.862a1 1 0 0 1 1.499.867v26.542Z" fill="currentColor"></path>
                                    </svg>
                                </button>
                                </div>
                                <div className="player-controls-center">
                                {track.is_playing ? (
                                    <button
                                        type="button"
                                        className={cn("DialogButton", STEAM_PLAYER.iconButton, STEAM_PLAYER.large, "player-play-btn")}
                                        onClick={() => handleCommand("pause")}
                                        title={t("pause")}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                            <path fill-rule="evenodd" clip-rule="evenodd" d="M6 6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v24a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6Zm16 0a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v24a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V6Z" fill="currentColor"></path>
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className={cn("DialogButton", STEAM_PLAYER.iconButton, STEAM_PLAYER.large, "player-play-btn")}
                                        onClick={() => handleCommand("play")}
                                        title={t("play")}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                            <path d="M7.5 32.135a1 1 0 0 1-1.5-.866V4.73a1 1 0 0 1 1.5-.866l22.999 13.269a1 1 0 0 1 0 1.732l-23 13.269Z" fill="currentColor"></path>
                                        </svg>
                                    </button>
                                )}
                                </div>
                                <div className="player-controls-side right">
                                <button
                                    type="button"
                                    className={cn("DialogButton", STEAM_PLAYER.iconButton)}
                                    onClick={() => handleCommand("next")}
                                    title={t("nextTrack")}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M4 31.27a1 1 0 0 0 1.499.868l20.514-11.803V30a1 1 0 0 0 1-1h4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v9.665L5.499 3.862A1 1 0 0 0 4 4.73v26.542Z" fill="currentColor"></path>
                                    </svg>
                                </button>
                                {supportsShuffleRepeat && (
                                    <button
                                        type="button"
                                        className={cn("DialogButton", STEAM_PLAYER.iconButton, isRepeatActive && STEAM_PLAYER.active)}
                                        onClick={() => handleCommand("repeat")}
                                        title={repeatTitle}
                                    >
                                        {track.repeat_state === "track" ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" style={{ position: "relative" }}>
                                                <path fillRule="evenodd" clip-rule="evenodd" d="M25.5154 9.89133V13.6514L34 7.53558L25.5154 1V5.17983H9.8247C5.51626 5.17983 2 8.64716 2 12.8957V19.2797H6.77831V12.8957C6.77831 11.2483 8.15372 9.8919 9.82446 9.8919L25.5154 9.89133ZM10.4846 26.5284V22.768L2 28.8842L10.4846 35V31.2399H26.1753C30.4837 31.2399 34 27.7726 34 23.5241V17.1401H29.2217V23.5241C29.2217 25.1714 27.8463 26.5278 26.1755 26.5278L10.4846 26.5284Z" fill="currentColor"></path>
                                                <text x="18" y="22" fontFamily="'Motiva Sans', sans-serif" fontSize="9" fontWeight="bold" fill="currentColor" textAnchor="middle">1</text>
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                                <path fill-rule="evenodd" clip-rule="evenodd" d="M25.5154 9.89133V13.6514L34 7.53558L25.5154 1V5.17983H9.8247C5.51626 5.17983 2 8.64716 2 12.8957V19.2797H6.77831V12.8957C6.77831 11.2483 8.15372 9.8919 9.82446 9.8919L25.5154 9.89133ZM10.4846 26.5284V22.768L2 28.8842L10.4846 35V31.2399H26.1753C30.4837 31.2399 34 27.7726 34 23.5241V17.1401H29.2217V23.5241C29.2217 25.1714 27.8463 26.5278 26.1755 26.5278L10.4846 26.5284Z" fill="currentColor"></path>
                                            </svg>
                                        )}
                                    </button>
                                )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {selectableSessions.length > 1 && (
                        <div className="player-session-picker">
                            <Dropdown
                                rgOptions={selectableSessions.map((session) => ({
                                    data: session.id,
                                    label: `${session.status === "Playing" ? "● " : "○ "}${session.title} — ${session.app}`
                                }))}
                                selectedOption={activeSessionId}
                                renderButtonValue={() => selectableSessions.find((s) => s.id === activeSessionId)?.title || t("sessionPicker")}
                                onChange={(opt: any) => handleSelectSession(opt.data)}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Inject the beautiful floating mini-player into Steam UI DOM inside the target overlay document
type PlayerContainer = HTMLDivElement & { __spotifyPlayerRoot?: ReactDOM.Root };

export function injectMiniPlayerIntoOverlay(overlayWindow: Window) {
    const overlayDoc = overlayWindow.document;
    let container = overlayDoc.getElementById("spotify-notifications-miniplayer-root") as PlayerContainer | null;

    if (!container) {
        container = overlayDoc.createElement("div") as PlayerContainer;
        container.id = "spotify-notifications-miniplayer-root";
        overlayDoc.body.appendChild(container);
    }

    if (container.childElementCount > 0) return;

    try {
        if (container.__spotifyPlayerRoot) {
            container.__spotifyPlayerRoot.render(<SpotifyMiniPlayer />);
        } else {
            const root = ReactDOM.createRoot(container);
            container.__spotifyPlayerRoot = root;
            root.render(<SpotifyMiniPlayer />);
        }
        console.debug("Mini-player successfully injected into Game Overlay!");
    } catch (e) {
        console.error("Failed to render mini-player inside overlay window:", e);
    }
}

// Polling monitor for dynamic overlay detection in the shared context (SharedJSContext)
export function startOverlayPolling() {
    let lastPopupsKey = "";
    const checkOverlay = () => {
        const g_PopupManager = (window as any).g_PopupManager;
        if (!g_PopupManager || !g_PopupManager.m_mapPopups) return;

        const popups = g_PopupManager.m_mapPopups;
        const popupsList: any[] = [];

        const checkWindow = (popupVal: any) => {
            const name = popupVal.m_strName || "";
            const overlayWindow = popupVal.m_popup;
            let title = "";
            let url = "";
            let isOverlay = false;

            if (overlayWindow && overlayWindow.document) {
                url = overlayWindow.location.href || "";
                title = overlayWindow.document.title || "";

                const lowerName = name.toLowerCase();

                isOverlay = lowerName.startsWith("desktopoverlay") ||
                    lowerName.startsWith("gameoverlay");

                if (isOverlay) {
                    const overlayDoc = overlayWindow.document;
                    if (overlayDoc.body) {
                        injectMiniPlayerIntoOverlay(overlayWindow);
                    }
                }
            }
            popupsList.push({ name, title, url, isOverlay });
        };

        if (typeof popups.forEach === "function") {
            popups.forEach(checkWindow);
        } else {
            for (const key in popups) {
                if (Object.prototype.hasOwnProperty.call(popups, key)) {
                    checkWindow(popups[key]);
                }
            }
        }

        const currentKey = popupsList.map(p => `${p.name}:${p.isOverlay}`).join("|");
        if (currentKey !== lastPopupsKey) {
            lastPopupsKey = currentKey;
            console.log(`Active windows in Steam PopupManager:`, popupsList);
        }
    };

    setInterval(checkOverlay, 1000);
}