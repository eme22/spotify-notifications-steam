mod http;
mod logs;
mod media;
mod state;

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
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

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let is_dev = args.iter().any(|a| a == "--dev");

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
    let port_file = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("port.txt");

    tokio::fs::write(&port_file, port.to_string()).await.ok();

    let app = http::build_router(state_json, provider.clone(), log_buffer);
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
