# Spotify Setup (Legacy Web API Mode)

If you wish to use the official **Spotify Web API** mode instead of the plug-and-play **Windows Media Mode** (which requires zero setup or authentication), follow the instructions below.

---

## 📋 Setup Instructions

### 1. Create a Spotify Developer Application

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications).
2. Log in with your Spotify account and click **Create app**.
3. Fill out the application details:
   - **App name**: e.g., `Steam Notifications`
   - **App description**: e.g., `Spotify notifications inside Steam`
   - **Redirect URI**: **MUST be exactly** `http://localhost:8888/callback`
4. Agree to the developer terms and click **Save**.
5. Once created, click on **Settings** in your new app dashboard to view and copy your **Client ID** and **Client Secret**.

---

### 2. Configure credentials in Steam settings

There is no longer any need for `.env` files or Python dependencies. Everything is configured directly inside Steam's Millennium interface:

1. Launch Steam with Millennium active.
2. Go to Steam Settings -> **Plugins** and enable **Spotify & Windows Media Notifications**.
3. Click the configuration/gear icon next to the plugin to open the **Control Panel**.
4. In the **Connection Mode** dropdown, select **Spotify Web API**.
5. Enter your **Client ID** and **Client Secret** into the respective text fields.

---

### 3. Authenticate with Spotify

1. Under the Spotify Web API credentials section, click the **Authenticate Spotify** button.
2. This will open your web browser requesting access to your Spotify playback information. Log in and click **Agree**.
3. After approving, you will be redirected to a page that won't load (since it points to `http://localhost:8888/callback`). **Do not worry!**
4. Copy the entire URL of that page from your browser's address bar (it should look like `http://localhost:8888/callback?code=AQ...`).
5. Return to the Steam plugin Control Panel and paste that URL (or just the `code` parameter value) into the **Auth Code / URL** input field.
6. Click **Exchange Code**. The plugin will fetch your tokens and link your account.
7. Click **Save Settings** at the bottom to start monitoring!

---

## ⚡ Features

- **Direct Web API Polling**: Queries Spotify's player API directly for active track, album cover, and status.
- **Local Storage Caching**: Keeps your Access and Refresh tokens stored safely inside Steam's Chromium context local storage (`localStorage`). No credential files are written to disk.
- **Automatic Token Refreshing**: Automatically handles token expiration and refreshes the Access Token in the background using your Client Secret.
- **Adjustable Polling**: Configure how often the plugin queries the Web API to balance responsiveness and API rate-limiting.

---

## 🏗️ Architecture (Spotify Web API)

```
[ Steam client (Millennium React) ] 
          │
          ├─► Saves credentials, Access & Refresh tokens to local storage (localStorage)
          ├─► Directly fetches playing state from "https://api.spotify.com/v1/me/player"
          ├─► Displays native Steam notifications using Millennium's toaster
          └─► Refreshes expired Access Tokens using Spotify's token endpoint
```

---

## 🔍 Troubleshooting

### "Invalid Client" or Authorization Errors
- Verify that your **Client ID** and **Client Secret** are entered correctly without trailing spaces.
- Double-check that your Spotify developer app has `http://localhost:8888/callback` set as a Redirect URI (check spelling carefully).

### Polling is sluggish
- You can adjust the **Polling Interval** slider in the Control Panel down to `1.0s` or `1.5s` for faster state updates. Note that very low values might trigger Spotify rate limits if kept active for extended periods.

### Why use Windows Media Mode instead?
We highly recommend selecting **Windows Media** mode in the Connection Mode settings instead of Web API. Windows Media mode requires:
- **No** Spotify developer account.
- **No** authentication or web browser login.
- Zero delay/polling rate limits (it listens directly to Windows system events).
- Extremely low memory consumption (<12MB).

