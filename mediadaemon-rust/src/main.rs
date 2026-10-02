mod http;
mod logs;
mod media;
mod state;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use rand::RngCore;
use tokio::net::TcpListener as TokioTcpListener;
use tracing_subscriber::prelude::*;

use media::MediaProvider;
use state::CachedState;

#[cfg(windows)]
use media::windows::WindowsMediaProvider;

fn get_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind to a free port");
    listener.local_addr().unwrap().port()
}

/// Per-boot shared secret handed to the plugin over the localhost port.txt handshake.
///
/// The HTTP server binds to 127.0.0.1, but "loopback only" is not an access control: any web
/// page the user visits can issue requests to 127.0.0.1:<port> because the browser will happily
/// send the request, and a permissive CORS policy would even let it read the reply. Requiring
/// this header on every route means such a page gets 403 instead of controlling playback,
/// reading track state, or triggering the `stop` command (which exits the process).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Write the handshake file consumed by the Lua backend.
///
/// Contents are `<port>\n<token>`. The Lua backend reads it once during its startup poll
/// and deletes it immediately, so the window in which the token sits on disk is short.
///
/// Residual risk, accepted deliberately: the file inherits the permissions of the plugin
/// directory, so another local user who can read that directory could read the token during
/// that window. Tightening it would mean setting a Windows DACL, which is not worth the
/// complexity for a desktop app whose real access control is the token check on every route.
async fn write_handshake_file(path: &PathBuf, contents: &str) {
    if let Err(e) = tokio::fs::write(path, contents).await {
        tracing::error!("Failed to write handshake file {}: {}", path.display(), e);
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let is_dev = args.iter().any(|a| a == "--dev");
    let allowed_origins = args
        .iter()
        .find_map(|a| a.strip_prefix("--allowed-origins="))
        .map(|s| s.to_string());

    let log_buffer = logs::LogBuffer::new(500);
    let mut _guard = None;

    if is_dev {
        let log_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));

        let file_appender = tracing_appender::rolling::never(&log_dir, "media-daemon.log");
        let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
        _guard = Some(guard);

        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer(file_writer)
            .with_ansi(false)
            .with_filter(tracing_subscriber::EnvFilter::new("debug"));

        tracing_subscriber::registry()
            .with(file_layer)
            .with(log_buffer.clone())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(log_buffer.clone())
            .init();
    }

    #[cfg(windows)]
    let provider: std::sync::Arc<dyn MediaProvider> = {
        match WindowsMediaProvider::new().await {
            Ok(p) => p as Arc<dyn MediaProvider>,
            Err(e) => {
                tracing::error!("Failed to initialize Windows SMTC: {}", e);
                return;
            }
        }
    };

    let cached_state = CachedState::new(provider.clone());
    let state_json = cached_state.json();

    let port = get_free_port();
    let token = generate_token();
    let port_file = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("port.txt");

    // Two lines: port, then token. The Lua backend reads both and deletes the file.
    let handshake = format!("{port}\n{token}");
    write_handshake_file(&port_file, &handshake).await;

    let app = http::build_router(
        state_json,
        provider.clone(),
        log_buffer,
        token.clone(),
        allowed_origins,
    );
    let listener = TokioTcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .expect("Failed to bind HTTP server");

    tracing::info!("MediaDaemon listening on 127.0.0.1:{}", port);

    // Event-driven refresh via provider's change notifier
    let cached_state_evt = cached_state.clone();
    let provider_evt = provider.clone();
    tokio::spawn(async move {
        loop {
            if let Some(notify) = provider_evt.change_notifier() {
                notify.notified().await;
                cached_state_evt.refresh().await;
            } else {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    });

    // Periodic timer (1.5s) for progress sync while playing
    let cached_state_timer = cached_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
        loop {
            interval.tick().await;
            cached_state_timer.refresh().await;
        }
    });

    // Start HTTP server
    axum::serve(listener, app).await.unwrap();
}
