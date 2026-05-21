import { 
    toaster, 
    ToggleField, 
    TextField, 
    SliderField, 
    Dropdown,
    ButtonItem 
} from "@steambrew/client";
import React, { useState } from "react";
import { STORAGE_KEYS } from "../constants/keys";
import { startMonitoring, stopMonitoring, exchangeAuthCode, postToChannel } from "../services/monitoring";
import { SpotifyNotifications } from "../services/notifications";
import { t } from "../utils/localization";

export const SpotifySettingsIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="#1DB954" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.893-.982-.336.076-.67-.135-.746-.472-.076-.336.135-.67.472-.746 3.852-.878 7.14-.504 9.822 1.138.295.18.387.565.207.86zm1.226-2.722c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.076-1.183-.412.125-.845-.107-.97-.52-.125-.412.107-.845.52-.97 3.666-1.11 8.24-.57 11.34 1.34.368.226.488.707.26 1.074zm.107-2.828C14.49 8.892 8.7 8.7 5.344 9.72c-.52.157-1.07-.14-1.228-.66-.157-.52.14-1.07.66-1.228 3.864-1.173 10.24-.95 14.18 1.39.468.278.622.885.344 1.353-.278.468-.885.622-1.353.344z"/>
    </svg>
);

export const NativeSettingsPanel: React.FC = () => {
    const [mode, setMode] = useState<"playback" | "webapi" | "winmedia">(
        (localStorage.getItem(STORAGE_KEYS.MODE) as "playback" | "webapi" | "winmedia") || "playback"
    );
    const [host, setHost] = useState(localStorage.getItem(STORAGE_KEYS.HOST) || "127.0.0.1");
    const [port, setPort] = useState(localStorage.getItem(STORAGE_KEYS.PORT) || "8443");
    const [clientId, setClientId] = useState(localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || "");
    const [clientSecret, setClientSecret] = useState(localStorage.getItem(STORAGE_KEYS.CLIENT_SECRET) || "");
    const [authCode, setAuthCode] = useState("");
    const [pollingInterval, setPollingInterval] = useState(
        parseFloat(localStorage.getItem(STORAGE_KEYS.POLLING_INTERVAL) || "2.0")
    );
    const [minInterval, setMinInterval] = useState(
        parseFloat(localStorage.getItem(STORAGE_KEYS.MIN_INTERVAL) || "2.0")
    );
    const [playSound, setPlaySound] = useState(
        localStorage.getItem(STORAGE_KEYS.PLAY_SOUND) === "true"
    );
    const [syncNative, setSyncNative] = useState(
        localStorage.getItem(STORAGE_KEYS.SYNC_NATIVE) !== "false"
    );
    const [syncVolume, setSyncVolume] = useState(
        localStorage.getItem(STORAGE_KEYS.SYNC_VOLUME) !== "false"
    );

    const saveSettings = () => {
        localStorage.setItem(STORAGE_KEYS.MODE, mode);
        localStorage.setItem(STORAGE_KEYS.HOST, host);
        localStorage.setItem(STORAGE_KEYS.PORT, port);
        localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId);
        localStorage.setItem(STORAGE_KEYS.CLIENT_SECRET, clientSecret);
        localStorage.setItem(STORAGE_KEYS.POLLING_INTERVAL, pollingInterval.toString());
        localStorage.setItem(STORAGE_KEYS.MIN_INTERVAL, minInterval.toString());
        localStorage.setItem(STORAGE_KEYS.PLAY_SOUND, playSound.toString());
        localStorage.setItem(STORAGE_KEYS.SYNC_NATIVE, syncNative.toString());
        localStorage.setItem(STORAGE_KEYS.SYNC_VOLUME, syncVolume.toString());

        // Restart background monitoring loop
        stopMonitoring();
        startMonitoring();

        // Broadcast settings update to other windows
        postToChannel({ type: "SETTINGS_UPDATED" });

        toaster.toast({
            title: t("toastSavedTitle"),
            body: t("toastSavedBody"),
            eType: 1
        } as any);
    };

    const handleAuthenticate = () => {
        if (!clientId) {
            toaster.toast({
                title: t("toastErrorTitle"),
                body: t("toastErrorClientIdRequired"),
                eType: 2
            } as any);
            return;
        }
        
        const redirectUri = encodeURIComponent("http://localhost:8888/callback");
        const scopes = encodeURIComponent("user-read-currently-playing user-read-playback-state user-modify-playback-state");
        const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}`;
        
        toaster.toast({
            title: t("toastAuthTitle"),
            body: t("toastAuthOpening"),
            eType: 1
        } as any);
        window.open(authUrl, "_blank");
    };

    const handleExchangeCode = async () => {
        if (!clientId || !clientSecret || !authCode) {
            toaster.toast({
                title: t("toastErrorTitle"),
                body: t("toastErrorCredentialsRequired"),
                eType: 2
            } as any);
            return;
        }

        try {
            let actualCode = authCode.trim();
            if (actualCode.includes("code=")) {
                const urlObj = new URL(actualCode);
                actualCode = urlObj.searchParams.get("code") || actualCode;
            }

            const tokens = await exchangeAuthCode(clientId, clientSecret, actualCode);
            
            localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
            localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
            localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, (Date.now() + tokens.expiresIn * 1000).toString());

            setAuthCode("");
            toaster.toast({
                title: t("toastSavedTitle"),
                body: t("toastAuthLinked"),
                eType: 1
            } as any);
            
            saveSettings();
        } catch (err: any) {
            toaster.toast({
                title: t("toastAuthErrorTitle"),
                body: err.message || t("toastAuthExchangeFailed"),
                eType: 2
            } as any);
        }
    };

    const triggerTestNotification = () => {
        SpotifyNotifications.sendNotification(
            t("pluginTitle"),
            "https://accounts.spotify.com/images/favicon.png",
            t("testNotifBody"),
            t("testNotifArtist"),
            t("testNotifAlbum"),
            playSound
        );
    };

    const modeOptions = [
        { data: "playback", label: t("modeLocalServer") },
        { data: "webapi", label: t("modeWebApi") },
        { data: "winmedia", label: t("modeWinMedia") }
    ];

    return (
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "14px", color: "#e1e2e6", fontWeight: 600 }}>{t("connectionMode")}</div>
                <div style={{ fontSize: "12px", color: "#a3a3ac", marginBottom: "4px" }}>{t("connectionModeDesc")}</div>
                <Dropdown
                    rgOptions={modeOptions}
                    selectedOption={mode}
                    renderButtonValue={() => modeOptions.find(opt => opt.data === mode)?.label || t("selectConnectionMode")}
                    onChange={(opt) => setMode(opt.data)}
                />
            </div>

            {mode === "playback" && (
                <>
                    <TextField
                        label={t("serverHost")}
                        description={t("serverHostDesc")}
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                    />
                    <TextField
                        label={t("serverPort")}
                        description={t("serverPortDesc")}
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                    />
                </>
            )}

            {mode === "webapi" && (
                <>
                    <TextField
                        label={t("clientId")}
                        description={t("clientIdDesc")}
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                    />
                    <TextField
                        label={t("clientSecret")}
                        description={t("clientSecretDesc")}
                        bIsPassword={true}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "6px" }}>
                        <div style={{ fontSize: "12px", color: "#a3a3ac" }}>
                            {t("authInstruction")}
                        </div>
                        <ButtonItem onClick={handleAuthenticate}>
                            {t("authBtn1")}
                        </ButtonItem>
                        <TextField
                            label={t("authCodeUrl")}
                            description={t("authCodeUrlDesc")}
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value)}
                        />
                        <ButtonItem onClick={handleExchangeCode} disabled={!authCode}>
                            {t("authBtn2")}
                        </ButtonItem>
                    </div>
                </>
            )}

            {mode === "winmedia" && (
                <div style={{ padding: "12px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "6px", fontSize: "12px", color: "#a3a3ac", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ fontWeight: 600, color: "#e1e2e6" }}>{t("winMediaHeader")}</div>
                    <div>{t("winMediaDesc")}</div>
                </div>
            )}

            <ToggleField
                label={t("syncNative")}
                description={t("syncNativeDesc")}
                checked={syncNative}
                onChange={(val) => setSyncNative(val)}
            />

            <ToggleField
                label={t("syncVolume")}
                description={t("syncVolumeDesc")}
                checked={syncVolume}
                disabled={!syncNative}
                onChange={(val) => setSyncVolume(val)}
            />

            <ToggleField
                label={t("playSound")}
                description={t("playSoundDesc")}
                checked={playSound}
                onChange={(val) => setPlaySound(val)}
            />

            {mode === "webapi" && (
                <>
                    <SliderField
                        label={t("pollingInterval")}
                        description={t("pollingIntervalDesc")}
                        min={1.0}
                        max={10.0}
                        step={0.5}
                        value={pollingInterval}
                        showValue={true}
                        valueSuffix="s"
                        onChange={(val) => setPollingInterval(val)}
                    />
                    <SliderField
                        label={t("minInterval")}
                        description={t("minIntervalDesc")}
                        min={1.0}
                        max={10.0}
                        step={0.5}
                        value={minInterval}
                        showValue={true}
                        valueSuffix="s"
                        onChange={(val) => setMinInterval(val)}
                    />
                </>
            )}

            <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
                <ButtonItem onClick={saveSettings}>{t("saveSettings")}</ButtonItem>
                <ButtonItem onClick={triggerTestNotification}>{t("testNotification")}</ButtonItem>
            </div>
        </div>
    );
};
