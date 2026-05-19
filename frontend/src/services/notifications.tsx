import { Millennium, toaster } from "@steambrew/client";
import { ToastData } from "@steambrew/client/build/hooks/toaster-hook";
import React from "react";
import { console } from "../utils/logger";

export class SpotifyNotifications {
    static sendNotification(title: string, icon: string, trackName: string, trackArtist: string, trackAlbum: string, playSound = false) {
        console.debug("Triggering Spotify notification:", { title, icon, trackName, trackArtist, trackAlbum });
        
        try {
            // Create the React element for the Spotify icon / artwork
            const node: React.ReactNode = icon ? (
                <img 
                    src={icon} 
                    alt="Artwork" 
                    style={{ 
                        width: '48px', 
                        height: '48px', 
                        borderRadius: 'var(--dialog-button-border-radius, var(--DialogRadius, var(--gpCorner-Medium, var(--gpCorner-Small, 6px))))',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                        objectFit: 'cover'
                    }} 
                />
            ) : (
                <div 
                    style={{ 
                        width: '48px', 
                        height: '48px', 
                        borderRadius: 'var(--dialog-button-border-radius, var(--DialogRadius, var(--gpCorner-Medium, var(--gpCorner-Small, 6px))))',
                        background: '#1DB954',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '20px'
                    }}
                >
                    ♫
                </div>
            );

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
