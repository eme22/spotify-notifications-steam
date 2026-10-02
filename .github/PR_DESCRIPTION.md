# Spotify Notifications

Steam notifications and a floating mini-player for whatever Windows is playing. The plugin
subscribes to Windows' System Media Transport Controls, so it works with Spotify, a browser,
VLC, or anything else that registers a media session. No account, API key or extra service
is required.

## What it does

- Fires a Steam toast when a new track starts playing, with the real cover art.
- Floating mini-player overlay, draggable and collapsible, injected into Steam windows.
- Optional Spotify Web API mode for per-user track data plus volume, seek, shuffle and repeat.

## Implementation notes

- **Frontend**: React injected into Steam's CEF contexts, settings registered through
  `definePlugin()` with `Field`/`Toggle`/`Slider`/`Button` from `@steambrew/client`. The
  background context (`SharedJSContext`) owns the polling loop and broadcasts track updates to
  the other windows over a `BroadcastChannel`.
- **Backend**: a standard Millennium LuaJIT backend, exposed via `definePlugin` and callable RPC.
- **Media access**: Windows SMTC is not reachable from Lua or CEF, so the plugin ships a small
  Rust daemon (`backend/mediadaemon.exe`, ~1.5 MB, built with tokio + axum) that the Lua backend
  launches silently and that reads SMTC directly.
- **Default mode needs no setup.** Windows Media works immediately. Spotify Web API mode requires
  a Client ID from the Spotify Developer Dashboard, because Spotify's Web API is the only way to
  get volume/seek/shuffle/repeat.

## Security

The daemon binds to `127.0.0.1` on a random port and **requires an `x-mediadaemon-token` header
on every request**. Loopback alone is not an access control, since any page open in a browser can
send a request to `127.0.0.1:<port>`. The token is 32 random bytes generated per launch, handed
to the Lua backend over a `port.txt` handshake, and compared in constant time.

Verified behaviour:

| Request | Result |
| --- | --- |
| `/state`, `/logs`, `/command` without the token | `403` |
| `/command?cmd=stop` without the token | `403`, daemon survives |
| Any request with an incorrect token | `403` |

CORS additionally restricts origins to the Steam client (`https://steamloopback.host` and the
Steam web origins), rather than the previous permissive policy. Rejected origins are logged so a
future Steam client update is visible rather than silent.

This can be verified locally against a running daemon:

```bash
curl -i http://127.0.0.1:<port>/state            # 403
curl -i -H "x-mediadaemon-token: <token>" ...    # 200
```

The token is per-boot, so it is never written to the repository or shipped in configuration.

## Third-party components

- [`tokio`](https://github.com/tokio-rs/tokio), [`axum`](https://github.com/tokio-rs/axum),
  [`serde`](https://github.com/serde-rs/serde), [`rand`](https://github.com/rust-random/rand),
  [`tower-http`](https://github.com/tokio-rs/tower-http) — all MIT/Apache-2.0. The daemon's
  `Cargo.lock` is committed, and the full notice set is in `mediadaemon-rust/Cargo.lock`.
- [`@steambrew/client`](https://www.npmjs.com/package/@steambrew/client) and
  [`@steambrew/ttc`](https://www.npmjs.com/package/@steambrew/ttc) from Millennium.
- No paid or external services are required. Spotify is only contacted if the user explicitly
  enables the Web API mode and supplies their own Client ID.

## A note on committed build artifacts

`.millennium/Dist/index.js` and `backend/mediadaemon.exe` are committed to this repository. This
is deliberate: the PluginDatabase release pipeline does not build anything, it only copies
already-committed files, and it hard-fails if `.millennium/` is missing. A `verify-artifacts`
job in `.github/workflows/ci.yml` rebuilds both and fails the build if the committed copies drift
from their sources, so a stale binary cannot reach users.

## AI assistance disclosure

AI tooling was used for a substantial portion of this code, including the Rust daemon, the
frontend, the CI workflow and parts of this description. The debugging, architecture decisions and
the security model were driven by the author. Per the submission guidelines this is disclosed
explicitly rather than presented as fully hand-written. I am able to maintain and fix this plugin
when Steam updates.

## Testing

- Steam Client **Stable**: tested, including a clean install with no prior configuration.
- Steam Client **Beta**: tested, including a clean install with no prior configuration.

The default Windows Media path was verified end to end: the backend launches the daemon, the
`port.txt` handshake completes, the background context polls `/state` every 1.5 s, and track
changes raise Steam toasts. The token rejection cases in the Security section were checked
against a running daemon rather than by inspection.
