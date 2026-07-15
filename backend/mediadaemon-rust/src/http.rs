use std::sync::Arc;
use axum::{
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

use crate::logs::LogBuffer;
use crate::media::MediaProvider;

#[derive(Deserialize)]
struct CommandQuery {
    cmd: Option<String>,
}

pub fn build_router(
    state_json: Arc<RwLock<String>>,
    provider: Arc<dyn MediaProvider>,
    log_buffer: LogBuffer,
) -> Router {
    let cors = CorsLayer::permissive();

    Router::new()
        .route("/state", get({
            let state_json = state_json.clone();
            move || get_state(state_json)
        }))
        .route("/command", post({
            let provider = provider.clone();
            move |query| post_command(query, provider.clone())
        }))
        .route("/logs", get({
            let log_buffer = log_buffer.clone();
            move || get_logs(log_buffer)
        }))
        .layer(cors)
}

async fn get_state(state_json: Arc<RwLock<String>>) -> (axum::http::StatusCode, String) {
    let json = state_json.read().await;
    (axum::http::StatusCode::OK, json.clone())
}

async fn get_logs(log_buffer: LogBuffer) -> (axum::http::StatusCode, String) {
    let entries = log_buffer.drain();
    let lines: Vec<String> = entries
        .iter()
        .map(|e| format!("{}: {}", e.level, e.message))
        .collect();
    (axum::http::StatusCode::OK, lines.join("\n"))
}

async fn post_command(
    query: axum::extract::Query<CommandQuery>,
    provider: Arc<dyn MediaProvider>,
) -> axum::http::StatusCode {
    match query.cmd.as_deref() {
        Some("play") => provider.play().await,
        Some("pause") => provider.pause().await,
        Some("next") => provider.next().await,
        Some("previous") => provider.previous().await,
        Some("stop") => {
            tracing::info!("Stop command received, initiating shutdown");
            std::process::exit(0);
        }
        _ => {}
    }
    axum::http::StatusCode::OK
}
