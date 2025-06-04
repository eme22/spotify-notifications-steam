import { Millennium, toaster } from "@steambrew/client";
import { ToastData } from "@steambrew/client/build/hooks/toaster-hook";

declare global {
    interface Window {
        uiStore: {
            currentUserSteamID: {
                ConvertTo64BitString: () => string;
            };
        };
    }
}

class SpotifyNotifications {
    static sendNotification(title: string, icon: string, trackName: string, trackArtist: string, trackAlbum: string) {
        console.debug("Received notification from backend:", { title, icon, trackName, trackArtist, trackAlbum });
        
        try {

            const node: React.ReactNode = (
                <img src={icon} alt="Spotify Icon" style={{ width: '48px', height: '48px' }} />
            );

            toaster.toast({
                title: title,
                body: trackName,
                subtext: `${trackArtist} - ${trackAlbum}`,
                playSound: false,
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

Millennium.exposeObj({ SpotifyNotifications });

export default async function PluginMain() {
    console.log("Spotify Notifications Plugin loaded");
}
