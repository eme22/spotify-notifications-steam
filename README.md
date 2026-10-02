# Spotify & Windows Media Notifications for Steam

Millennium plugin that shows Steam notifications when a song plays from Spotify (or any Windows media app). Includes a floating mini-player overlay and native Steam settings panel.

---

## Installation

### Option A: Download Release

1. Download the latest `.zip` from [Releases](https://github.com/eme22/spotify-notifications-steam/releases).
2. Extract into `C:\Program Files (x86)\Steam\millennium\plugins\spotify-notifications-steam\`
3. Restart Steam, go to Millennium settings → Plugins → enable **Spotify Notifications**.

No further setup is required: the plugin starts in **Windows Media** mode, which needs no
account, no API key and no extra service. See [Connection modes](#connection-modes).

### Option B: Clone & Deploy (Development)

```powershell
cd "C:\Program Files (x86)\Steam\millennium\plugins"
git clone https://github.com/eme22/spotify-notifications-steam.git
cd spotify-notifications-steam
npm install

# Dev mode — debug logging to backend/media-daemon.log
.\deploy-dev.ps1

# Prod mode — release binary, no log file
.\deploy-prod.ps1
```

Both scripts build the Rust daemon, build the frontend, and copy only the necessary files to the Steam plugins directory (no source code).

### Connection modes

The plugin defaults to **Windows Media**, which is the only mode with no external requirements.
The other two are opt-in:

| Mode | Requirements | Notes |
|---|---|---|
| **Windows Media** (default) | None | Reads whatever Windows reports via SMTC, so it works with Spotify, browsers, VLC, anything registered as a media session. Volume, seek, shuffle and repeat are **not** supported here, only transport controls. |
| **Spotify Web API** | A Spotify app in the [Developer Dashboard](https://developer.spotify.com/dashboard) | You supply the Client ID. Full control including volume, seek, shuffle and repeat, and per-user track data. |
| **Local Playback Server** | A **third-party** server the plugin does **not** ship, listening on `127.0.0.1:8443` | Legacy path kept for compatibility. You must run and trust that server yourself; the plugin only talks to whatever host and port you type into settings. |

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
  - port.txt handshake → Lua discovers port + per-boot token
  - /state, /command, /logs (all require the token header)
          │
  backend/main.lua (LuaJIT)
  - Launches daemon silently via FFI CreateProcessA
  - Exposes get_daemon_port(), get_daemon_token(), get_daemon_logs() as RPC
  - Polls port.txt up to 20×100ms for handshake
```

### Communication flow

| Between | Method | Details |
|---|---|---|
| Lua → Daemon | `port.txt` handshake | Daemon writes its port and per-boot token; Lua reads + deletes the file |
| Frontend → Lua | Millennium `callable()` RPC | `get_daemon_port()`, `get_daemon_token()`, `get_daemon_logs()` |
| Frontend → Daemon | HTTP fetch (localhost) | Polls `/state`, sends `/command`, reads `/logs`; all carry the token header |
| Frontend ↔ Frontend | `BroadcastChannel("spotify_notifications_steam")` | `TRACK_UPDATE`, `PLAYBACK_COMMAND`, `REQUEST_INITIAL_STATE` |

---

## Project Structure

```
spotify-notifications-steam/
├── plugin.json                  # Millennium plugin metadata
├── .millennium/Dist/index.js   # Compiled frontend (React)
├── backend/                   # Shipped as-is by the release pipeline
│   ├── main.lua                # LuaJIT backend (entry point)
│   ├── mediadaemon.exe         # Rust daemon binary (committed build output)
│   ├── .daemon-dev             # Dev mode marker (created by deploy-dev)
│   └── media-daemon.log        # Debug log (dev mode only)
├── mediadaemon-rust/          # Rust source for the daemon (not shipped)
│   ├── Cargo.toml
│   └── src/                    # main.rs, http.rs, logs.rs, state.rs, media/
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

## Contributing: committed build artifacts

Two build outputs are **committed to this repository**:

- `.millennium/Dist/index.js`
- `backend/mediadaemon.exe`

This is deliberate and is not a mistake. The Millennium PluginDatabase release pipeline does not
build anything; it only copies files that are already committed. It hard-fails when `.millennium/`
is missing, and it copies `backend/` verbatim, so a missing or stale `mediadaemon.exe` would ship
a plugin whose Windows Media mode can never start.

That is also why the Rust source lives in `mediadaemon-rust/` at the repository root rather than
inside `backend/`: the pipeline copies `backend/` whole and has no way to exclude files, so keeping
the source outside it keeps the published archive down to the binary it actually runs.

The consequence is that **you must rebuild and commit these files whenever you change their
sources**:

```powershell
# After editing anything under frontend/
npm run build
git add .millennium

# After editing anything under mediadaemon-rust/
cargo build --release --manifest-path mediadaemon-rust/Cargo.toml
Copy-Item mediadaemon-rust/target/release/mediadaemon.exe backend/
git add backend/mediadaemon.exe
```

The `verify-artifacts` job in `.github/workflows/ci.yml` rebuilds both and fails the build if the
committed copies are out of date, so a forgotten rebuild cannot silently reach users.

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

The daemon binds to `127.0.0.1` on a random port and **requires an `x-mediadaemon-token`
header on every request**. The token is a 32-byte random hex secret generated per launch and
handed to the Lua backend over the `port.txt` handshake.

This matters because loopback is not an access control: any page open in any browser can send
a request to `127.0.0.1:<port>`, and browsers treat loopback as an ordinary origin. Without the
token, a page you visit could read your track state, control playback, or send `cmd=stop` to kill
the daemon. Requests without a valid token get `403`.

CORS is additionally restricted to Steam client origins (override with
`--allowed-origins=https://a,https://b`). The Lua backend calls the daemon with `curl`, which
sends no `Origin` and is therefore unaffected by CORS.

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
