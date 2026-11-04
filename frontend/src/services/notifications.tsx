import { Millennium, toaster } from "@steambrew/client";
import { ToastData } from "@steambrew/client/build/hooks/toaster-hook";
import React from "react";
import { console } from "../utils/logger";

const ARTWORK_STYLE: React.CSSProperties = {
    width: '48px',
    height: '48px',
    borderRadius: 'var(--dialog-button-border-radius, var(--DialogRadius, var(--gpCorner-Medium, var(--gpCorner-Small, 6px))))',
    boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
    objectFit: 'cover'
};

const FALLBACK_STYLE: React.CSSProperties = {
    ...ARTWORK_STYLE,
    background: '#1DB954',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
};

const SpotifyLogo: React.FC = () => (
    <div style={FALLBACK_STYLE}>
        <svg viewBox="0 0 24 24" width="32" height="32" fill="#fff" aria-hidden="true">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
    </div>
);

/**
 * Toast artwork that never shows a broken image: a missing or unloadable cover falls back to the
 * Spotify mark instead of the browser's placeholder icon.
 */
const NotificationArtwork: React.FC<{ icon: string }> = ({ icon }) => {
    const [failed, setFailed] = React.useState(false);
    if (!icon || failed) return <SpotifyLogo />;
    return <img src={icon} alt="" style={ARTWORK_STYLE} onError={() => setFailed(true)} />;
};

export class SpotifyNotifications {
    static sendNotification(title: string, icon: string, trackName: string, trackArtist: string, trackAlbum: string, playSound = false) {
        console.debug("Triggering Spotify notification:", { title, icon, trackName, trackArtist, trackAlbum });
        
        try {
            const node: React.ReactNode = <NotificationArtwork icon={icon} />;

            toaster?.toast({
                title: title,
                body: trackName,
                subtext: `${trackArtist} - ${trackAlbum}`,
                playSound: playSound,
                logo: node,
                eType: 2,
                onClick: () => {
                    console.log("Spotify Notification clicked");
                },
            } as ToastData);

        } catch (error) {
            console.error("Failed to send Steam notification:", error);
        }
    }
}

// Expose the obj for backwards compatibility (in case anything else hooks into it)
Millennium.exposeObj({ SpotifyNotifications });
