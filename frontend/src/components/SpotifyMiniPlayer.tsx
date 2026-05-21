import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { postToChannel, listenToChannel } from "../services/monitoring";
import { currentTrackState, onTrackChange } from "../services/state";
import { formatTime } from "../utils/helpers";
import { console } from "../utils/logger";
import { t } from "../utils/localization";

export const SpotifyMiniPlayer: React.FC = () => {
    const [track, setTrack] = useState<any>(currentTrackState);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [localProgress, setLocalProgress] = useState(0);
    const localProgressRef = useRef<number>(0);

    const updateLocalProgress = (progress: number) => {
        localProgressRef.current = progress;
        setLocalProgress(progress);
    };

    // Handle collapse state locally (injected strictly into a single view now)
    const toggleCollapsed = (collapsed: boolean) => {
        setIsCollapsed(collapsed);
    };

    // Track state sync (local + broadcast channel)
    useEffect(() => {
        const unsubscribe = onTrackChange((newTrack) => {
            setTrack(newTrack);
        });

        const unsubscribeChannel = listenToChannel((e: MessageEvent) => {
            if (e.data.type === "TRACK_UPDATE") {
                setTrack(e.data.track);
            }
        });

        // Request initial state from main client background process
        console.log(`[Spotify Notifications MiniPlayer] Requesting initial state from backend...`);
        postToChannel({ type: "REQUEST_INITIAL_STATE" });

        return () => {
            unsubscribe();
            unsubscribeChannel();
        };
    }, []);

    const baselineTrackIdRef = useRef<string | null>(null);
    const baselineProgressRef = useRef<number>(0);
    const baselineTimeRef = useRef<number>(0);
    const baselineIsPlayingRef = useRef<boolean>(false);

    // Track baseline and process API updates (Reference updates)
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
        const currentProgress = track.progress_ms || 0;
        const currentTime = Date.now();
        const currentIsPlaying = track.is_playing || false;

        // Detect if this is the first lookup of this song, OR if the playing state changed
        const isFirstLookup = baselineTrackIdRef.current !== currentTrackId;
        const isPlayStateChanged = baselineIsPlayingRef.current !== currentIsPlaying;

        if (isFirstLookup) {
            baselineTrackIdRef.current = currentTrackId;
            baselineProgressRef.current = currentProgress;
            baselineTimeRef.current = currentTime;
            baselineIsPlayingRef.current = currentIsPlaying;
            updateLocalProgress(currentProgress);
            return;
        }

        if (isPlayStateChanged) {
            baselineTrackIdRef.current = currentTrackId;
            baselineIsPlayingRef.current = currentIsPlaying;
            baselineTimeRef.current = currentTime;
            
            if (!currentIsPlaying) {
                // Paused: Freeze baseline progress at the exact current smooth localProgress position
                baselineProgressRef.current = localProgressRef.current;
                updateLocalProgress(localProgressRef.current);
            } else {
                // Resumed: Resume tracking from where we paused (baselineProgressRef.current),
                // but reset baselineTimeRef to currentTime so elapsed starts counting from now!
                updateLocalProgress(baselineProgressRef.current);
            }
            return;
        }

        // Subsequent updates: calculate estimated progress based on baseline
        let estimatedProgress = baselineProgressRef.current;
        if (currentIsPlaying) {
            estimatedProgress += (currentTime - baselineTimeRef.current);
        }

        // Check the discrepancy between estimated progress and the API's progress
        const diff = Math.abs(currentProgress - estimatedProgress);

        // If the difference is more than 3 seconds, update the baseline to the real API progress
        if (diff > 3000) {
            console.log(`[Spotify MiniPlayer] Discrepancy detected (${diff}ms > 3s). Resyncing baseline to API real progress: ${currentProgress}ms`);
            baselineProgressRef.current = currentProgress;
            baselineTimeRef.current = currentTime;
            updateLocalProgress(currentProgress);
        }
    }, [track]);

    // High-frequency real-time estimated progress renderer
    useEffect(() => {
        if (!track || !track.is_playing) {
            return () => {};
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

    // Handle playback commands
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

        // Optimistically update playing state immediately for instant responsive playback visual feedback
        if (command === "play") {
            setTrack((prev: any) => prev ? { ...prev, is_playing: true } : prev);
        } else if (command === "pause") {
            setTrack((prev: any) => prev ? { ...prev, is_playing: false } : prev);
        }

        // Request the main background window (SharedJSContext) to execute the command
        postToChannel({ type: "PLAYBACK_COMMAND", command, value });
    };

    if (!track) return null;

    const progressPercent = track.duration_ms > 0 ? (localProgress / track.duration_ms) * 100 : 0;
    const isShuffleActive = track.shuffle_state === true;
    const isRepeatActive = track.repeat_state === "context" || track.repeat_state === "track";
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
            target.closest("button") || 
            target.closest(".window-controls") || 
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
        if (!isDragging) return () => {};

        const handleMouseMove = (e: MouseEvent) => {
            if (!dragStartRef.current) return;

            const deltaX = e.clientX - dragStartRef.current.startX;
            const deltaY = e.clientY - dragStartRef.current.startY;

            let newX = dragStartRef.current.posX + deltaX;
            let newY = dragStartRef.current.posY + deltaY;

            // Bounding to viewport
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

    return (
        <div 
            ref={playerRef}
            onMouseDown={handleMouseDown}
            style={{
                position: "fixed",
                zIndex: 999999,
                fontFamily: "'Motiva Sans', Arial, Helvetica, sans-serif",
                userSelect: "none",
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
                :root {
                    /* Playback Green accents (Steam's primary brand accent!) */
                    --player-accent: #90ba3c;
                }

                .glass-player {
                    padding: 8px;
                    width: 320px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    box-sizing: border-box;
                    position: relative;

                    /* Pure native cross-theme variable chain for background, borders, and radius! */
                    background: var(--dialog-bg, var(--gpBackground-DarkSoft, var(--DarkGreenBG, var(--GreenBG, rgba(30, 37, 51, 0.98))))) !important;
                    border: var(--gpBorder-Medium, var(--Outset, 1px solid rgba(255, 255, 255, 0.1))) !important;
                    border-radius: var(--gpCorner-Large, 0px) !important;
                    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
                }

                .player-header {
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    padding: 2px 4px;
                }

                .player-avatar-and-user {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    width: 100%;
                    z-index: 1;
                }

                .player-avatar-holder {
                    width: 42px;
                    height: 42px;
                    min-width: 42px;
                }

                .player-avatar-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .player-label-holder {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    padding-left: 4px;
                }

                .player-title-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .player-title {
                    font-weight: bold;
                    font-size: 13px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .player-artist {
                    color: var(--player-accent);
                    font-size: 11px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* Absolute positioned wrapper for themed native close controls */
                .glass-player .window-controls {
                    position: absolute !important;
                    top: 4px !important;
                    right: 4px !important;
                    z-index: 10 !important;
                    display: flex !important;
                    gap: 4px !important;
                    padding: 0 !important;
                    background: transparent !important;
                    border: none !important;
                }
                .glass-player .window-controls .title-area-icon {
                    cursor: pointer !important;
                }

                .player-progress-container {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    padding: 0 4px;
                }

                .player-progress-track {
                    height: 4px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 2px;
                    position: relative;
                    overflow: hidden;
                }

                .player-progress-bar {
                    height: 100%;
                    background: var(--player-accent);
                    border-radius: 2px;
                    transition: width 0.1s linear;
                }

                .player-durations {
                    display: flex;
                    justify-content: space-between;
                    font-size: 10px;
                    color: var(--text-muted, #a3a3ac);
                }

                .player-controls {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 10px;
                    margin-top: 2px;
                }

                /* Highly specific button selectors to override Steam's native padding/margins and force layout dimensions, 
                   while leaving background, border-radius, and borders untouched to let custom themes style them natively! */
                div.friendlist.glass-player button.DialogButton.control-btn {
                    width: 32px !important;
                    height: 32px !important;
                    min-width: 32px !important;
                    max-width: 32px !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 !important;
                    flex-grow: 0 !important;
                    flex-shrink: 0 !important;
                    flex: none !important;
                    box-sizing: border-box !important;
                    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
                    cursor: pointer;
                }
                div.friendlist.glass-player button.DialogButton.control-btn:hover {
                    transform: scale(1.08) !important;
                }
                div.friendlist.glass-player button.DialogButton.control-btn.active-btn {
                    color: var(--player-accent) !important;
                }

                div.friendlist.glass-player button.DialogButton.control-btn-play {
                    width: 38px !important;
                    height: 38px !important;
                    min-width: 38px !important;
                    max-width: 38px !important;
                    padding: 0 !important;
                    flex-grow: 0 !important;
                    flex-shrink: 0 !important;
                    flex: none !important;
                    box-sizing: border-box !important;
                }
                div.friendlist.glass-player button.DialogButton.control-btn svg {
                    width: 14px !important;
                    height: 14px !important;
                    display: block !important;
                }
                div.friendlist.glass-player button.DialogButton.control-btn-play svg {
                    width: 18px !important;
                    height: 18px !important;
                    color: var(--player-accent) !important; /* Highlights the Play button icon beautifully in standard themes! */
                }

                .player-collapsed-avatar {
                    width: 48px;
                    height: 48px;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }

                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            {isCollapsed ? (
                <div onClick={() => toggleCollapsed(false)} className="friendlist FriendsListContent DialogBody ModalPosition" style={{ cursor: "pointer" }} title={t("miniPlayerOpen")}>
                    <div className="nibodjvvrm86uCfnnAn4g avatarHolder no-drag Medium ingame player-collapsed-avatar">
                        <div className="_3xUpb5DWXPFNcHHIcv-9pe avatarStatus"></div>
                        <img className="_3h-QRJGxnVOIExtHD1R0f2 avatar player-avatar-img" draggable="false" src={track.image_url || "https://avatars.steamstatic.com/f1fdf8e7465a06c2b1806a448ef27af283afeb29_medium.jpg"} />
                    </div>
                </div>
            ) : (
                <div className="friendlist FriendsListContent DialogBody ModalPosition glass-player">
                    {/* Upper Header Row styled as a Community Friend Item */}
                    <div className="currentUserContainer ingame player-header">
                        <svg className="statusHeaderGlow" width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, zIndex: 0, opacity: 0.5, pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <radialGradient id="spotifyGreenGlow" cx="20%" cy="30%" r="60%">
                                    <stop offset="0%" stopColor="#90ba3c" stopOpacity="0.4"></stop>
                                    <stop offset="100%" stopColor="transparent"></stop>
                                </radialGradient>
                            </defs>
                            <ellipse cx="20%" cy="30%" rx="80%" ry="70%" fill="url(#spotifyGreenGlow)"></ellipse>
                        </svg>

                        <div className="AvatarAndUser player-avatar-and-user">
                            <div className="currentUserAvatar">
                                <div className="nibodjvvrm86uCfnnAn4g avatarHolder no-drag Medium ingame player-avatar-holder">
                                    <div className="_3xUpb5DWXPFNcHHIcv-9pe avatarStatus"></div>
                                    <img className="_3h-QRJGxnVOIExtHD1R0f2 avatar player-avatar-img" draggable="false" src={track.image_url || "https://avatars.steamstatic.com/f1fdf8e7465a06c2b1806a448ef27af283afeb29_medium.jpg"} />
                                </div>
                            </div>

                            <div className="labelHolder ingame _1BbOegz8bYL7iPzgYpOgQI player-label-holder">
                                <div className="_4ZTzGZ5TTgFyfw1DcXLXS player-title-row">
                                    <div className="nOdcT-MoOaXGePXLyPe0H player-title" title={track.name} style={{ marginRight: "32px" }}>
                                        {track.name}
                                    </div>
                                </div>
                                <div className="_3sxE7F1LV2IcSX68YsH9dI">
                                    <div className="_1cB0qtF0paHWWyj1XNcnbG _2Ri005Wg_uXDTa71kdRbcN no-drag player-artist" title={track.artist}>
                                        {track.artist}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Top-Right Themed Window Control Close Button */}
                        <div className="title-bar-actions window-controls">
                            <div className="title-area-icon closeButton windowControlButton" onClick={() => toggleCollapsed(true)} title={t("miniPlayerMinimize")}>
                                <div className="title-area-icon-inner">
                                    <svg version="1.1" id="Layer_2" xmlns="http://www.w3.org/2000/svg" className="SVGIcon_Button SVGIcon_X_Line" x="0px" y="0px" width="256px" height="256px" viewBox="0 0 256 256">
                                        <line fill="none" stroke="#FFFFFF" strokeWidth="45" strokeMiterlimit="10" x1="212" y1="212" x2="44" y2="44"></line>
                                        <line fill="none" stroke="#FFFFFF" strokeWidth="45" strokeMiterlimit="10" x1="44" y1="212" x2="212" y2="44"></line>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar & Durations */}
                    <div className="player-progress-container">
                        <div className="player-progress-track">
                            <div className="player-progress-bar" style={{ width: `${progressPercent}%` }} />
                        </div>
                        <div className="player-durations">
                            <span>{formatTime(localProgress)}</span>
                            <span>{formatTime(track.duration_ms)}</span>
                        </div>
                    </div>

                    {/* Controls Row */}
                    <div className="player-controls">
                        <button 
                            type="button" 
                            className={`DialogButton Secondary Focusable control-btn${isShuffleActive ? ' active-btn' : ''}`} 
                            onClick={() => handleCommand("shuffle")} 
                            title={isShuffleActive ? t("shuffleOn") : t("shuffleOff")}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fillRule="evenodd" clip-rule="evenodd" d="M2.00023 24.453H4.84442C6.92144 24.453 8.26825 22.9277 9.32331 21.1763L15.3048 11.2448C17.1871 8.11946 19.9271 5.76281 23.5619 5.76281H26.038L26.0379 2L33.9995 8.15498L26.0386 14.3096V10.5472H23.5624C21.5098 10.5472 20.1227 12.0984 19.0835 13.8239L13.1017 23.7561C11.1813 26.9448 8.58909 29.2381 4.84462 29.2381H2.0001L2.00023 24.453ZM2.00023 10.547H4.84442C6.92144 10.547 8.26825 12.0723 9.32331 13.8238L9.86817 14.7281L12.5155 10.3325C10.6604 7.62746 8.22064 5.76215 4.84419 5.76215L2 5.76202L2.00023 10.547ZM26.0384 20.6906V24.453H23.5622C21.5096 24.453 20.1225 22.9018 19.0833 21.1763L18.5385 20.2719L15.8931 24.6641C17.7422 27.3264 20.2893 29.2375 23.5622 29.2375H26.1776L26.0384 33L34 26.8454L26.0384 20.6906Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        <button 
                            type="button" 
                            className="DialogButton Secondary Focusable control-btn" 
                            onClick={() => handleCommand("previous")} 
                            title={t("prevTrack")}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M32.013 31.27a1 1 0 0 1-1.499.868L10 20.335V30a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9.665L30.514 3.862a1 1 0 0 1 1.499.867v26.542Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        {track.is_playing ? (
                            <button 
                                type="button" 
                                className="DialogButton Secondary Focusable control-btn control-btn-play" 
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
                                className="DialogButton Secondary Focusable control-btn control-btn-play" 
                                onClick={() => handleCommand("play")} 
                                title={t("play")}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                    <path d="M7.5 32.135a1 1 0 0 1-1.5-.866V4.73a1 1 0 0 1 1.5-.866l22.999 13.269a1 1 0 0 1 0 1.732l-23 13.269Z" fill="currentColor"></path>
                                </svg>
                            </button>
                        )}
                        <button 
                            type="button" 
                            className="DialogButton Secondary Focusable control-btn" 
                            onClick={() => handleCommand("next")} 
                            title={t("nextTrack")}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M4 31.27a1 1 0 0 0 1.499.868l20.514-11.803V30a1 1 0 0 0 1-1h4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v9.665L5.499 3.862A1 1 0 0 0 4 4.73v26.542Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        <button 
                            type="button" 
                            className={`DialogButton Secondary Focusable control-btn${isRepeatActive ? ' active-btn' : ''}`} 
                            onClick={() => handleCommand("repeat")} 
                            title={repeatTitle}
                        >
                            {track.repeat_state === "track" ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" style={{ position: 'relative' }}>
                                    <path fill-rule="evenodd" clip-rule="evenodd" d="M25.5154 9.89133V13.6514L34 7.53558L25.5154 1V5.17983H9.8247C5.51626 5.17983 2 8.64716 2 12.8957V19.2797H6.77831V12.8957C6.77831 11.2483 8.15372 9.8919 9.82446 9.8919L25.5154 9.89133ZM10.4846 26.5284V22.768L2 28.8842L10.4846 35V31.2399H26.1753C30.4837 31.2399 34 27.7726 34 23.5241V17.1401H29.2217V23.5241C29.2217 25.1714 27.8463 26.5278 26.1755 26.5278L10.4846 26.5284Z" fill="currentColor"></path>
                                    <text x="18" y="22" fontFamily="'Motiva Sans', sans-serif" fontSize="9" fontWeight="bold" fill="currentColor" textAnchor="middle">1</text>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                    <path fill-rule="evenodd" clip-rule="evenodd" d="M25.5154 9.89133V13.6514L34 7.53558L25.5154 1V5.17983H9.8247C5.51626 5.17983 2 8.64716 2 12.8957V19.2797H6.77831V12.8957C6.77831 11.2483 8.15372 9.8919 9.82446 9.8919L25.5154 9.89133ZM10.4846 26.5284V22.768L2 28.8842L10.4846 35V31.2399H26.1753C30.4837 31.2399 34 27.7726 34 23.5241V17.1401H29.2217V23.5241C29.2217 25.1714 27.8463 26.5278 26.1755 26.5278L10.4846 26.5284Z" fill="currentColor"></path>
                                </svg>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Inject the beautiful floating mini-player into Steam UI DOM inside the target overlay document
export function injectMiniPlayerIntoOverlay(overlayWindow: Window) {
    const overlayDoc = overlayWindow.document;
    if (overlayDoc.getElementById("spotify-notifications-miniplayer-root")) return;

    const container = overlayDoc.createElement("div");
    container.id = "spotify-notifications-miniplayer-root";
    overlayDoc.body.appendChild(container);

    try {
        const root = ReactDOM.createRoot(container);
        root.render(<SpotifyMiniPlayer />);
        console.debug("[Spotify Notifications] Mini-player successfully injected into Game Overlay!");
    } catch (e) {
        console.error("[Spotify Notifications] Failed to render mini-player inside overlay window:", e);
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

        // Only log when the popup list changes (to keep console clean)
        const currentKey = popupsList.map(p => `${p.name}:${p.isOverlay}`).join("|");
        if (currentKey !== lastPopupsKey) {
            lastPopupsKey = currentKey;
            console.log(`[Spotify Notifications] Active windows in Steam PopupManager:`, popupsList);
        }
    };

    // Poll every 1 second
    setInterval(checkOverlay, 1000);
}
