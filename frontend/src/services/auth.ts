import { STORAGE_KEYS } from "../constants/keys";
import { console } from "../utils/logger";

export interface SpotifyTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export interface BeginAuthorizationResult {
    authUrl: string;
    redirectUri: string;
    state: string;
    expiresAt: number;
}

const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";
const TOKEN_ENDPOINT = `${SPOTIFY_ACCOUNTS_BASE}/api/token`;
const AUTHORIZE_ENDPOINT = `${SPOTIFY_ACCOUNTS_BASE}/authorize`;
export const REDIRECT_URI = "http://127.0.0.1:8888/callback";
export const LEGACY_REDIRECT_URI = "http://localhost:8888/callback";
export const LEGACY_CLIENT_SECRET_KEY = "spotify_notif_client_secret";
export const AUTH_SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state";
const STATE_TTL_MS = 10 * 60 * 1000;
const PKCE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const VERIFIER_LENGTH = 96;

let inflightRefresh: Promise<SpotifyTokenResponse> | null = null;
let inflightExchange: Promise<SpotifyTokenResponse> | null = null;

const randomString = (length: number): string => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let result = "";
    for (let i = 0; i < length; i++) {
        result += PKCE_CHARSET[bytes[i] % PKCE_CHARSET.length];
    }
    return result;
};

const base64UrlEncode = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deriveChallenge = async (verifier: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64UrlEncode(digest);
};

const clearAuthTransaction = () => {
    localStorage.removeItem(STORAGE_KEYS.AUTH_STATE);
    localStorage.removeItem(STORAGE_KEYS.AUTH_STATE_EXPIRY);
    localStorage.removeItem(STORAGE_KEYS.AUTH_VERIFIER);
};

const clearTokens = () => {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
};

const isDisconnectFlagged = (): boolean =>
    localStorage.getItem(STORAGE_KEYS.AUTH_DISCONNECTING) === "true";

const markDisconnectFlag = (value: boolean) => {
    if (value) {
        localStorage.setItem(STORAGE_KEYS.AUTH_DISCONNECTING, "true");
    } else {
        localStorage.removeItem(STORAGE_KEYS.AUTH_DISCONNECTING);
    }
};

const persistTokens = (tokens: SpotifyTokenResponse) => {
    if (isDisconnectFlagged()) {
        console.log("Disconnect requested during token exchange; discarding tokens.");
        clearTokens();
        return;
    }
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, (Date.now() + tokens.expiresIn * 1000).toString());
};

const parseTokenResponse = (data: any, fallbackRefreshToken: string | null): SpotifyTokenResponse => ({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? fallbackRefreshToken ?? "",
    expiresIn: data.expires_in
});

const requestToken = async (body: URLSearchParams): Promise<SpotifyTokenResponse> => {
    const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Spotify Auth Error: ${response.status} - ${data.error || response.statusText}`);
    }
    return data;
};

export const isTokenExpired = (): boolean => {
    const expiry = localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
    if (!expiry) return true;
    return Date.now() >= parseInt(expiry, 10);
};

export async function beginAuthorization(clientId: string): Promise<BeginAuthorizationResult> {
    if (!clientId) {
        throw new Error("clientId is required");
    }

    const verifier = randomString(VERIFIER_LENGTH);
    const state = randomString(32);
    const codeChallenge = await deriveChallenge(verifier);
    const expiresAt = Date.now() + STATE_TTL_MS;

    localStorage.setItem(STORAGE_KEYS.AUTH_VERIFIER, verifier);
    localStorage.setItem(STORAGE_KEYS.AUTH_STATE, state);
    localStorage.setItem(STORAGE_KEYS.AUTH_STATE_EXPIRY, expiresAt.toString());

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        state,
        scope: AUTH_SCOPES,
        code_challenge_method: "S256",
        code_challenge: codeChallenge
    });

    return {
        authUrl: `${AUTHORIZE_ENDPOINT}?${params.toString()}`,
        redirectUri: REDIRECT_URI,
        state,
        expiresAt
    };
}

export async function exchangeAuthCode(clientId: string, callbackUrl: string): Promise<SpotifyTokenResponse> {
    const raw = callbackUrl.trim();
    let code: string | null = null;
    let state: string | null = null;
    let error: string | null = null;

    try {
        const url = new URL(raw);
        code = url.searchParams.get("code");
        state = url.searchParams.get("state");
        error = url.searchParams.get("error");
    } catch {
        code = raw;
    }

    if (error) {
        clearAuthTransaction();
        throw new Error(`Spotify authorization failed: ${error}`);
    }

    if (!code) {
        throw new Error("No authorization code found in the callback URL.");
    }

    const storedState = localStorage.getItem(STORAGE_KEYS.AUTH_STATE);
    const storedVerifier = localStorage.getItem(STORAGE_KEYS.AUTH_VERIFIER);
    const storedExpiry = localStorage.getItem(STORAGE_KEYS.AUTH_STATE_EXPIRY);

    if (!storedState || !storedVerifier) {
        throw new Error("No pending authorization transaction. Start the authorization flow again.");
    }
    if (!state || state !== storedState) {
        clearAuthTransaction();
        throw new Error("Authorization state mismatch. Start the authorization flow again.");
    }
    if (storedExpiry && Date.now() > parseInt(storedExpiry, 10)) {
        clearAuthTransaction();
        throw new Error("Authorization request expired. Start the authorization flow again.");
    }

    clearAuthTransaction();

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code.trim(),
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: storedVerifier
    });

    const execute = async (): Promise<SpotifyTokenResponse> => {
        try {
            const tokens = await requestToken(body);
            persistTokens(tokens);
            return tokens;
        } finally {
            inflightExchange = null;
        }
    };

    inflightExchange = execute();
    return inflightExchange;
}

export async function refreshAccessToken(clientId: string, refreshToken: string): Promise<SpotifyTokenResponse> {
    if (isDisconnectFlagged()) {
        throw new Error("Spotify account is being disconnected.");
    }

    if (inflightRefresh) {
        return inflightRefresh;
    }

    const execute = async (): Promise<SpotifyTokenResponse> => {
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId
        });

        try {
            const data = await requestToken(body);
            const tokens = parseTokenResponse(data, refreshToken);
            persistTokens(tokens);
            return tokens;
        } finally {
            inflightRefresh = null;
        }
    };

    inflightRefresh = execute();
    return inflightRefresh;
}

export async function disconnectSpotify(): Promise<void> {
    markDisconnectFlag(true);
    try {
        const pending = [inflightExchange, inflightRefresh].filter(Boolean) as Promise<SpotifyTokenResponse>[];
        // Annotated explicitly: without it the callbacks' return types are implicitly `any`.
        await Promise.all(
            pending.map((p): Promise<SpotifyTokenResponse | undefined> =>
                p.catch((): undefined => undefined)
            )
        );
    } finally {
        clearTokens();
        clearAuthTransaction();
        markDisconnectFlag(false);
    }
}

export function migrateLegacyAuth(): { migrated: boolean; requiresRelink: boolean } {
    const legacySecret = localStorage.getItem(LEGACY_CLIENT_SECRET_KEY);
    if (!legacySecret) {
        return { migrated: false, requiresRelink: false };
    }

    clearTokens();
    clearAuthTransaction();
    localStorage.removeItem(LEGACY_CLIENT_SECRET_KEY);
    console.log("Legacy client secret detected; tokens cleared. Re-linking required with PKCE.");
    return { migrated: true, requiresRelink: true };
}
