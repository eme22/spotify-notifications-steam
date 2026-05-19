import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { postToChannel, listenToChannel } from "../services/monitoring";
import { currentTrackState, onTrackChange } from "../services/state";
import { formatTime } from "../utils/helpers";
import { console } from "../utils/logger";

export const SpotifyMiniPlayer: React.FC = () => {
    const [track, setTrack] = useState<any>(currentTrackState);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [localProgress, setLocalProgress] = useState(0);
    const progressIntervalRef = useRef<any>(null);

    // Handle collapse state locally (injected strictly into a single view now)
    const toggleCollapsed = (collapsed: boolean) => {
        setIsCollapsed(collapsed);
    };

    // Track state sync (local + broadcast channel)
    useEffect(() => {
        const unsubscribe = onTrackChange((newTrack) => {
            setTrack(newTrack);
            if (newTrack) {
                setLocalProgress(newTrack.progress_ms || 0);
            }
        });

        const unsubscribeChannel = listenToChannel((e: MessageEvent) => {
            if (e.data.type === "TRACK_UPDATE") {
                setTrack(e.data.track);
                if (e.data.track) {
                    setLocalProgress(e.data.track.progress_ms || 0);
                }
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

    // Smooth real-time progress bar increment
    useEffect(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }

        if (track && track.is_playing) {
            progressIntervalRef.current = setInterval(() => {
                setLocalProgress(prev => {
                    const next = prev + 1000;
                    return next > track.duration_ms ? track.duration_ms : next;
                });
            }, 1000);
        }

        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [track]);

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

        // Request the main background window (SharedJSContext) to execute the command
        postToChannel({ type: "PLAYBACK_COMMAND", command, value });
    };

    if (!track) return null;

    const progressPercent = track.duration_ms > 0 ? (localProgress / track.duration_ms) * 100 : 0;
    const isShuffleActive = track.shuffle_state === true;
    const isRepeatActive = track.repeat_state === "context" || track.repeat_state === "track";
    const repeatTitle = track.repeat_state === "track" ? "Repeat: One" : track.repeat_state === "context" ? "Repeat: All" : "Repeat: Off";

    return (
        <div style={{
            position: "fixed",
            bottom: "35px",
            right: "25px",
            zIndex: 999999,
            fontFamily: "'Motiva Sans', Arial, Helvetica, sans-serif",
            userSelect: "none"
        }}>
            <style>{`
                .glass-player {
                    background: var(--dialog-input-bg, var(--DialogBG, rgba(20, 24, 33, 0.85)));
                    backdrop-filter: blur(24px) saturate(180%);
                    -webkit-backdrop-filter: blur(24px) saturate(180%);
                    border: 1px solid var(--dialog-border-color, var(--DialogBorder, rgba(255, 255, 255, 0.1)));
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
                    border-radius: var(--dialog-button-border-radius, var(--DialogRadius, 12px));
                    padding: 14px;
                    width: 320px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    color: var(--text-color, #e1e2e6);
                    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .spotify-pill {
                    width: 46px;
                    height: 46px;
                    background: var(--brand-primary, var(--brand-color, #1DB954));
                    border-radius: 50%;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: var(--text-primary, #ffffff);
                    font-size: 22px;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    animation: pulseGlow 2s infinite alternate;
                }
                .spotify-pill:hover {
                    transform: scale(1.1) rotate(5deg);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes pulseGlow {
                    0% { box-shadow: 0 4px 12px rgba(29, 185, 84, 0.2); }
                    100% { box-shadow: 0 4px 22px rgba(29, 185, 84, 0.5); }
                }
                .control-btn {
                    width: 32px !important;
                    height: 32px !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 !important;
                    min-width: 0 !important;
                    border-radius: 50% !important;
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
                    cursor: pointer;
                }
                .control-btn:hover {
                    transform: scale(1.08) !important;
                }
                .control-btn svg {
                    width: 14px !important;
                    height: 14px !important;
                    display: block;
                }
                .control-btn-play {
                    width: 38px !important;
                    height: 38px !important;
                }
                .control-btn-play svg {
                    width: 18px !important;
                    height: 18px !important;
                }
            `}</style>

            {isCollapsed ? (
                <div onClick={() => toggleCollapsed(false)} className="spotify-pill" title="Open Spotify Controller">
                    {track.image_url ? (
                        <img src={track.image_url} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                        "♫"
                    )}
                </div>
            ) : (
                <div className="glass-player DialogBody ModalPosition">
                    {/* Upper Header Row */}
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        {track.image_url ? (
                            <img src={track.image_url} style={{ width: "48px", height: "48px", borderRadius: "var(--dialog-button-border-radius, var(--DialogRadius, 6px))", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }} />
                        ) : (
                            <div style={{ width: "48px", height: "48px", borderRadius: "var(--dialog-button-border-radius, var(--DialogRadius, 6px))", background: "var(--brand-primary, var(--brand-color, #1DB954))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                                ♫
                            </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: "bold", fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={track.name}>
                                {track.name}
                            </div>
                            <div style={{ color: "var(--text-muted, #a3a3ac)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={track.artist}>
                                {track.artist}
                            </div>
                        </div>
                        <button onClick={() => toggleCollapsed(true)} style={{ background: "none", border: "none", color: "var(--text-muted, #a3a3ac)", fontSize: "14px", cursor: "pointer", padding: "4px" }}>
                            ✕
                        </button>
                    </div>

                    {/* Progress Bar & Durations */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ height: "4px", background: "var(--dialog-slider-track-bg, var(--SliderTrackBG, rgba(255, 255, 255, 0.15)))", borderRadius: "2px", position: "relative", overflow: "hidden" }}>
                            <div style={{
                                height: "100%",
                                background: "var(--brand-primary, var(--brand-color, #1DB954))",
                                borderRadius: "2px",
                                width: `${progressPercent}%`,
                                transition: track.is_playing ? "width 1s linear" : "none"
                            }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted, #a3a3ac)" }}>
                            <span>{formatTime(localProgress)}</span>
                            <span>{formatTime(track.duration_ms)}</span>
                        </div>
                    </div>

                    {/* Controls Row */}
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                        <button 
                            type="button" 
                            className={`_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E DialogButton _DialogLayout Secondary Focusable control-btn${isShuffleActive ? ' active-btn' : ''}`} 
                            onClick={() => handleCommand("shuffle")} 
                            title={`Shuffle: ${isShuffleActive ? 'On' : 'Off'}`}
                            style={isShuffleActive ? { color: "var(--brand-primary, var(--brand-color, #1DB954))" } : undefined}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M2.00023 24.453H4.84442C6.92144 24.453 8.26825 22.9277 9.32331 21.1763L15.3048 11.2448C17.1871 8.11946 19.9271 5.76281 23.5619 5.76281H26.038L26.0379 2L33.9995 8.15498L26.0386 14.3096V10.5472H23.5624C21.5098 10.5472 20.1227 12.0984 19.0835 13.8239L13.1017 23.7561C11.1813 26.9448 8.58909 29.2381 4.84462 29.2381H2.0001L2.00023 24.453ZM2.00023 10.547H4.84442C6.92144 10.547 8.26825 12.0723 9.32331 13.8238L9.86817 14.7281L12.5155 10.3325C10.6604 7.62746 8.22064 5.76215 4.84419 5.76215L2 5.76202L2.00023 10.547ZM26.0384 20.6906V24.453H23.5622C21.5096 24.453 20.1225 22.9018 19.0833 21.1763L18.5385 20.2719L15.8931 24.6641C17.7422 27.3264 20.2893 29.2375 23.5622 29.2375H26.1776L26.0384 33L34 26.8454L26.0384 20.6906Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        <button 
                            type="button" 
                            className="_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E DialogButton _DialogLayout Secondary Focusable control-btn" 
                            onClick={() => handleCommand("previous")} 
                            title="Previous Track"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M32.013 31.27a1 1 0 0 1-1.499.868L10 20.335V30a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9.665L30.514 3.862a1 1 0 0 1 1.499.867v26.542Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        {track.is_playing ? (
                            <button 
                                type="button" 
                                className="_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E Upr_VRmq8Pb8RWegwuVYb DialogButton _DialogLayout Secondary Focusable control-btn control-btn-play" 
                                onClick={() => handleCommand("pause")} 
                                title="Pause"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                    <path fill-rule="evenodd" clip-rule="evenodd" d="M6 6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v24a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6Zm16 0a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v24a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V6Z" fill="currentColor"></path>
                                </svg>
                            </button>
                        ) : (
                            <button 
                                type="button" 
                                className="_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E Upr_VRmq8Pb8RWegwuVYb DialogButton _DialogLayout Secondary Focusable control-btn control-btn-play" 
                                onClick={() => handleCommand("play")} 
                                title="Play"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                    <path d="M7.5 32.135a1 1 0 0 1-1.5-.866V4.73a1 1 0 0 1 1.5-.866l22.999 13.269a1 1 0 0 1 0 1.732l-23 13.269Z" fill="currentColor"></path>
                                </svg>
                            </button>
                        )}
                        <button 
                            type="button" 
                            className="_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E DialogButton _DialogLayout Secondary Focusable control-btn" 
                            onClick={() => handleCommand("next")} 
                            title="Next Track"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M4 31.27a1 1 0 0 0 1.499.868l20.514-11.803V30a1 1 0 0 0 1-1h4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v9.665L5.499 3.862A1 1 0 0 0 4 4.73v26.542Z" fill="currentColor"></path>
                            </svg>
                        </button>
                        <button 
                            type="button" 
                            className={`_1iFnR7cGRa1kepep433pGx h782PaUbu8xm3afLFh83E DialogButton _DialogLayout Secondary Focusable control-btn${isRepeatActive ? ' active-btn' : ''}`} 
                            onClick={() => handleCommand("repeat")} 
                            title={repeatTitle}
                            style={isRepeatActive ? { color: "var(--brand-primary, var(--brand-color, #1DB954))" } : undefined}
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
