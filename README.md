# Spotify & Windows Media Notifications for Steam

Millennium plugin that shows Steam notifications when a song plays from Spotify (or any Windows media app). Includes a floating mini-player overlay and native Steam settings panel.

---

## Installation

### Option A: Download Release

1. Download the latest `.zip` from [Releases](https://github.com/yourusername/spotify-notifications-steam/releases).
2. Extract into `C:\Program Files (x86)\Steam\millennium\plugins\spotify-notifications-steam\`
3. Restart Steam, go to Millennium settings → Plugins → enable **Spotify Notifications**.
4. Open plugin settings and select **Windows Media** as source mode.

### Option B: Clone & Deploy (Development)

```powershell
cd "C:\Program Files (x86)\Steam\millennium\plugins"
git clone https://github.com/yourusername/spotify-notifications-steam.git
cd spotify-notifications-steam
npm install

# Dev mode — debug logging to backend/media-daemon.log
.\deploy-dev.ps1

# Prod mode — release binary, no log file
.\deploy-prod.ps1
```

Both scripts build the Rust daemon, build the frontend, and copy only the necessary files to the Steam plugins directory (no source code).

---

## Prerequisites

- **[Millennium](https://github.com/SteamClientHomebrew/Millennium)** (Steam client mod)
- **Windows 10 or 11**
- *(Dev only)* [Rust toolchain](https://rustup.rs/) + Node.js 20+

---

## Architecture

```
┌─ Steam CEF Context ─────────────────────────────────┐
│                                                      │
│  ┌─ SharedJSContext (background) ─┐  ┌─ UI Windows ─┐│
│  │  monitoring.ts (poll loop)     │  │ SettingsPanel ││
│  │  startOverlayPolling()         │  │ MiniPlayer    ││
│  │  ─────────BroadcastChannel─────│──│ hookNative*() ││
│  └────────────────────────────────┘  └──────────────┘│
│         │ HTTP fetch(/state, /command)                │
└─────────│────────────────────────────────────────────┘
          │
  backend/mediadaemon.exe (Rust)
  - tokio + axum HTTP server on random port
  - Windows SMTC event listener
  - port.txt handshake → Lua discovers port
  - /state, /command, /logs
          │
  backend/main.lua (LuaJIT)
  - Launches daemon silently via FFI CreateProcessA
  - Exposes get_daemon_port() and get_daemon_logs() as RPC
  - Polls port.txt up to 20×100ms for handshake
```

### Communication flow

| Between | Method | Details |
|---|---|---|
| Lua → Daemon | `port.txt` handshake | Daemon writes its port, Lua reads + deletes it |
| Frontend → Lua | Millennium `callable()` RPC | `get_daemon_port()`, `get_daemon_logs()` |
| Frontend → Daemon | HTTP fetch (localhost) | Polls `/state`, sends `/command`, reads `/logs` |
| Frontend ↔ Frontend | `BroadcastChannel("spotify_notifications_steam")` | `TRACK_UPDATE`, `PLAYBACK_COMMAND`, `REQUEST_INITIAL_STATE` |

---

## Project Structure

```
spotify-notifications-steam/
├── plugin.json                  # Millennium plugin metadata
├── .millennium/Dist/index.js   # Compiled frontend (React)
├── backend/
│   ├── main.lua                # LuaJIT backend (entry point)
│   ├── mediadaemon.exe         # Rust daemon binary
│   ├── .daemon-dev             # Dev mode marker (created by deploy-dev)
│   ├── mediadaemon-rust/       # Rust source (src/main.rs, http.rs, logs.rs, state.rs, media/)
│   └── media-daemon.log        # Debug log (dev mode only)
├── frontend/
│   ├── index.tsx               # React entry — splits on SharedJSContext vs UI
│   └── src/
│       ├── components/
│       │   ├── NativeSettingsPanel.tsx    # Steam settings UI
│       │   └── SpotifyMiniPlayer.tsx      # Floating overlay mini-player
│       ├── services/
│       │   ├── monitoring.ts   # Poll loop + 3 modes (winmedia/playback/webapi)
│       │   ├── notifications.tsx          # Steam toast notifications
│       │   └── state.ts        # Reactive track state
│       └── utils/
│           ├── localization.ts # EN / ES / PT translations
│           └── logger.ts       # Prefixed console wrapper
├── deploy-dev.ps1              # Build + deploy dev (debug + log file)
└── deploy-prod.ps1             # Build + deploy prod (release, no log)
```

---

## How It Works

1. **Lua** launches `mediadaemon.exe` silently via LuaJIT FFI `CreateProcessA` with `CREATE_NO_WINDOW`.
2. **Daemon** binds a random port, writes it to `port.txt`, starts the HTTP server, and listens for Windows SMTC events.
3. **Lua** discovers the port (polls `port.txt` up to 2s), then exposes it to the frontend via `get_daemon_port()` RPC.
4. **Frontend** (background `SharedJSContext`) periodically fetches `http://127.0.0.1:{port}/state` and broadcasts track updates to other Steam windows via `BroadcastChannel`.
5. **MiniPlayer** receives `TRACK_UPDATE` via broadcast and renders the draggable overlay in game windows.
6. Play/Pause/Next/Previous commands go from the UI → broadcast → background → daemon `/command` endpoint.

---

## Daemon HTTP API

| Endpoint | Method | Description |
|---|---|---|
| `/state` | GET | Current track JSON (title, artist, album, duration, progress, status, image) |
| `/command?cmd={play\|pause\|next\|previous\|stop}` | POST | Execute playback command; `stop` exits the daemon |
| `/logs` | GET | Drained buffered info+ log entries (plain text, one per line) |

---

## Dev / Prod Differences

| | Dev | Prod |
|---|---|---|
| Daemon build | `cargo build` (debug) | `cargo build --release` |
| Log file | `backend/media-daemon.log` (debug level) | None |
| `.daemon-dev` marker | Created (passes `--dev` flag) | Removed |
| Frontend | `npm run dev` | `npm run build` |
| Lua log forwarding | Info+ from `/logs` → `logger` | Same |

---

## Connection Modes

- **Windows Media (winmedia)**: Default, plug-and-play via SMTC daemon. No accounts needed.
- **Playback API (playback)**: Socket.IO connection to a local server. See [spotify-server](https://github.com/eme22/spotify-server).
- **Spotify Web API (webapi)**: OAuth-based Spotify API. See [SPOTIFY_SETUP.md](SPOTIFY_SETUP.md).

Switched in the plugin settings panel inside Steam.

---

## License

MIT

## Credits

Built for [Millennium](https://github.com/SteamClientHomebrew/Millennium).

## Support

[![Patreon](https://img.shields.io/badge/Patreon-Support_me-FF424D?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/c/eme22)
