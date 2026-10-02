use std::sync::Arc;
use axum::{
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::logs::LogBuffer;
use crate::media::MediaProvider;

/// Header the plugin's Lua backend and frontend must send on every request.
pub const TOKEN_HEADER: &str = "x-mediadaemon-token";

#[derive(Deserialize)]
struct CommandQuery {
    cmd: Option<String>,
}

/// Origins the Steam client loads the plugin's web context from.
///
/// `https://steamloopback.host` is the verified value: it is the origin Steam's CEF reports for
/// the injected plugin context, confirmed from a console error when the allowlist lacked it.
/// The others cover Steam pages that may host a plugin context in some client builds.
///
/// Requests with no `Origin` (the Lua backend uses `curl`) or an origin in this list pass the
/// CORS layer. Rejected origins are logged so a future Steam update that changes the origin
/// shows up in the log instead of silently breaking the plugin.
const DEFAULT_ALLOWED_ORIGINS: &[&str] = &[
    "https://steamloopback.host",
    "https://store.steampowered.com",
    "https://steamcommunity.com",
    "https://help.steampowered.com",
    "https://steam.tv",
];

fn parse_allowed_origins(raw: Option<&String>) -> Vec<HeaderValue> {
    let list: Vec<&str> = match raw {
        Some(value) => value
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect(),
        None => DEFAULT_ALLOWED_ORIGINS.to_vec(),
    };

    let mut out = Vec::new();
    for origin in list {
        match HeaderValue::from_str(origin) {
            Ok(value) => out.push(value),
            Err(_) => tracing::warn!("Ignoring malformed allowed origin: {origin}"),
        }
    }
    out
}

/// Compare in constant time to avoid leaking the token a byte at a time via timing.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Reject requests that do not carry the per-boot token.
///
/// This is the real access control for the daemon. Binding to 127.0.0.1 is not enough: a web
/// page the user visits in any browser can send a request to a loopback port, and browsers
/// treat loopback as an ordinary origin. Without this check such a page could read track
/// state, control playback, or send `cmd=stop`, which exits the process.
async fn require_token(expected: Arc<String>, request: Request, next: Next) -> Response {
    let provided = request
        .headers()
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok());

    let authorised = match provided {
        Some(value) => constant_time_eq(value.as_bytes(), expected.as_bytes()),
        None => false,
    };

    if authorised {
        return next.run(request).await;
    }

    // Distinguish "no token supplied" from "wrong token": they point at different bugs, and the
    // browser omits the header entirely when the frontend fails to attach it.
    if provided.is_none() {
        tracing::warn!(
            "Rejected request with NO {} header (origin {:?})",
            TOKEN_HEADER,
            origin_of(&request)
        );
    } else {
        tracing::warn!(
            "Rejected request with an incorrect {} (length {}, origin {:?})",
            TOKEN_HEADER,
            provided.map(str::len).unwrap_or(0),
            origin_of(&request)
        );
    }

    (StatusCode::FORBIDDEN, "missing or invalid media daemon token").into_response()
}

fn origin_of(request: &Request) -> String {
    request
        .headers()
        .get(header::ORIGIN)
        .map(|v| v.to_str().unwrap_or("<unparsable>").to_string())
        .unwrap_or_else(|| "<none>".to_string())
}

pub fn build_router(
    state_json: Arc<RwLock<String>>,
    provider: Arc<dyn MediaProvider>,
    log_buffer: LogBuffer,
    token: String,
    allowed_origins: Option<String>,
) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(parse_allowed_origins(allowed_origins.as_ref())))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::HeaderName::from_static(TOKEN_HEADER)]);

    let token = Arc::new(token);

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
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            require_token(Arc::clone(&token), request, next)
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
