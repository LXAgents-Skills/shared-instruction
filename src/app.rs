//! The HTTP transport, as an application.
//!
//! This module builds an axum [`Router`] and returns it. **It does not listen** — `src/http.rs`
//! owns the port. A unit that both builds the app and binds a port cannot be tested without
//! binding one.
//!
//! The surface is deliberately narrow: `POST /mcp` and `GET /healthz`, a JSON-RPC 405 for any
//! other method on `/mcp`, a JSON-RPC 404 for everything else, and one answer for a body that
//! cannot be read. Each request passes through, in order:
//!
//! 1. the `Host` allow-list, ahead of everything, `/healthz` included;
//! 2. the bearer token, ahead of the body and the routes, with `GET /healthz` the one exemption;
//! 3. the body, read here up to [`BODY_LIMIT_BYTES`] and checked to be JSON;
//! 4. rmcp's stateless Streamable HTTP service, with a fresh [`InstructionServer`] per request.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::auth::{TokenCheck, token_problem};
use crate::instructions::InstructionSet;
use crate::rpc_error::rpc_error;
use crate::server::InstructionServer;
use crate::version::{SERVER_NAME, VERSION};

/// The request body ceiling, in bytes: 4 MB, the smallest that holds a legitimate `tools/call`
/// against this set with enormous room to spare.
pub const BODY_LIMIT_BYTES: usize = 4 * 1024 * 1024;

/// The `Host` names a token-less local server answers to when no allow-list is configured.
///
/// A loopback bind keeps other machines out, but not a web page in this machine's browser: DNS
/// rebinding can point a hostile domain at `127.0.0.1`. With no token to stop it, the `Host`
/// check does, so an open server always has one. `MCP_ALLOWED_HOSTS`, when set, replaces it.
pub const LOOPBACK_HOSTNAMES: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// The `Host` allow-list from a raw `MCP_ALLOWED_HOSTS` value.
///
/// Unset, or nothing but commas and spaces, is an empty list: the check is skipped rather than
/// guessed at, and the absence is reported at startup.
pub fn parse_allowed_hosts(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .map(String::from)
        .collect()
}

/// How many `/mcp` requests are being answered right now. The drain reports it.
#[derive(Clone, Default)]
pub struct InFlight(Arc<AtomicUsize>);

impl InFlight {
    /// The current count.
    pub fn count(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }

    fn enter(&self) -> InFlightGuard {
        self.0.fetch_add(1, Ordering::SeqCst);
        InFlightGuard(self.0.clone())
    }
}

/// Decrements the count when the request it was taken for is finished, however it finished.
struct InFlightGuard(Arc<AtomicUsize>);

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// What [`create_app`] is built from. The entry point reads the environment and fills this in.
#[derive(Clone)]
pub struct AppOptions {
    /// The bearer token. Empty means none was configured.
    pub token: String,
    /// Whether a token is required. `false` is the one way to build an open app, and only when
    /// `token` is empty: a token that was given is always enforced.
    pub require_token: bool,
    /// The configured `Host` allow-list; empty when `MCP_ALLOWED_HOSTS` is unset.
    pub allowed_hosts: Vec<String>,
    /// The in-flight counter the drain reads.
    pub in_flight: InFlight,
    /// Cancelled on shutdown, which ends every stream the transport holds.
    pub shutdown: CancellationToken,
}

impl AppOptions {
    /// Options that require `token`, with no allow-list.
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            require_token: true,
            allowed_hosts: Vec::new(),
            in_flight: InFlight::default(),
            shutdown: CancellationToken::new(),
        }
    }
}

/// The `/mcp` handler's state: the transport, and the counter.
#[derive(Clone)]
struct McpState {
    service: StreamableHttpService<InstructionServer, LocalSessionManager>,
    in_flight: InFlight,
}

/// Build the HTTP application over `set`, or say why it cannot be built.
///
/// **By default there is no way to build it without a usable token**: a missing or short token
/// is an error, so an unauthenticated server cannot come from forgetting an option.
pub fn create_app(set: Arc<InstructionSet>, options: AppOptions) -> Result<Router, String> {
    let open = !options.require_token && options.token.is_empty();
    if !open && let Some(problem) = token_problem(&options.token) {
        return Err(format!("Refusing to build the HTTP app: {problem}."));
    }

    let hosts: Vec<String> = match (options.allowed_hosts.is_empty(), open) {
        (false, _) => options.allowed_hosts.clone(),
        (true, true) => LOOPBACK_HOSTNAMES
            .iter()
            .map(|host| host.to_string())
            .collect(),
        (true, false) => Vec::new(),
    };

    let state = McpState {
        service: mcp_service(set, options.shutdown.clone()),
        in_flight: options.in_flight,
    };
    let mut app = Router::new()
        .route("/healthz", get(health))
        .route("/mcp", any(mcp))
        .fallback(not_found)
        .with_state(state);

    // Layers run outermost-last-added, so this order puts the Host check first.
    if !open {
        let check = Arc::new(TokenCheck::new(&options.token));
        app = app.layer(middleware::from_fn(move |request: Request, next: Next| {
            let check = check.clone();
            async move { require_token(&check, request, next).await }
        }));
    }
    if !hosts.is_empty() {
        let hosts = Arc::new(hosts);
        app = app.layer(middleware::from_fn(move |request: Request, next: Next| {
            let hosts = hosts.clone();
            async move { require_allowed_host(&hosts, request, next).await }
        }));
    }
    Ok(app)
}

/// rmcp's Streamable HTTP service, stateless, with JSON responses.
///
/// rmcp's own `Host` check is off because [`require_allowed_host`] runs ahead of the token, and
/// rmcp's would run after it with a different answer. Each request builds its own handler over
/// the one shared set: sharing a handler across requests would share per-connection state.
fn mcp_service(
    set: Arc<InstructionSet>,
    shutdown: CancellationToken,
) -> StreamableHttpService<InstructionServer, LocalSessionManager> {
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .disable_allowed_hosts()
        .with_max_request_body_bytes(BODY_LIMIT_BYTES)
        .with_cancellation_token(shutdown);
    let template = InstructionServer::new(set);
    StreamableHttpService::new(
        move || Ok(template.clone()),
        Arc::new(LocalSessionManager::default()),
        config,
    )
}

/// The health check. Answers without a body, a session, or a tool.
async fn health() -> Response {
    axum::Json(json!({ "status": "ok", "server": SERVER_NAME, "version": VERSION })).into_response()
}

/// The MCP endpoint. `POST` is served; any other method is refused with a 405, because the path
/// exists and saying so is more useful than a 404.
async fn mcp(State(state): State<McpState>, request: Request) -> Response {
    if request.method() != Method::POST {
        let message = format!("{} is not supported in stateless mode", request.method());
        return rpc_error(StatusCode::METHOD_NOT_ALLOWED, -32000, message);
    }
    let _guard = state.in_flight.enter();
    let request = match read_json_body(request).await {
        Ok(request) => request,
        Err(refusal) => return refusal,
    };
    state.service.handle(request).await.into_response()
}

/// Read a JSON body up to the limit and check it parses, then hand the request on.
///
/// An oversized body and a malformed one get **the same** 400 / `-32700`: a client that sent
/// something unreadable gets one answer whichever way it was wrong. A body that does not claim
/// to be JSON is passed through, and the transport refuses its content type.
async fn read_json_body(request: Request) -> Result<Request, Response> {
    if !is_json(request.headers().get(header::CONTENT_TYPE)) {
        return Ok(request);
    }
    let (parts, body) = request.into_parts();
    let unreadable = || {
        rpc_error(
            StatusCode::BAD_REQUEST,
            -32700,
            "Parse error: request body is not valid JSON",
        )
    };
    let bytes = to_bytes(body, BODY_LIMIT_BYTES)
        .await
        .map_err(|_| unreadable())?;
    if serde_json::from_slice::<serde_json::Value>(&bytes).is_err() {
        return Err(unreadable());
    }
    Ok(Request::from_parts(parts, Body::from(bytes)))
}

/// Whether a `Content-Type` is `application/json`, parameters ignored.
fn is_json(content_type: Option<&HeaderValue>) -> bool {
    content_type
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|essence| essence.trim().eq_ignore_ascii_case("application/json"))
}

/// Anything else is not a route this server has.
async fn not_found(request: Request) -> Response {
    let target = request
        .uri()
        .path_and_query()
        .map_or("/", |target| target.as_str());
    rpc_error(
        StatusCode::NOT_FOUND,
        -32601,
        format!("Not found: {target}"),
    )
}

/// The token check. `GET /healthz` is the one exemption, and it is exact: the method and the
/// path, nothing that merely starts with it, so `HEAD` and `/healthz/` are refused.
async fn require_token(check: &TokenCheck, request: Request, next: Next) -> Response {
    if request.method() == Method::GET && request.uri().path() == "/healthz" {
        return next.run(request).await;
    }
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    match check.verify(authorization) {
        Ok(()) => next.run(request).await,
        Err(refusal) => {
            let mut response = rpc_error(StatusCode::UNAUTHORIZED, -32001, refusal.message());
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                HeaderValue::from_static(refusal.challenge()),
            );
            response
        }
    }
}

/// The `Host` allow-list. The port is not part of the match: a client behind a proxy sends
/// `host:port`, and matching the whole header would refuse it.
async fn require_allowed_host(hosts: &[String], request: Request, next: Next) -> Response {
    let Some(raw) = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return rpc_error(StatusCode::FORBIDDEN, -32000, "Missing Host header");
    };
    let Some(hostname) = hostname_of(raw) else {
        return rpc_error(
            StatusCode::FORBIDDEN,
            -32000,
            format!("Invalid Host header: {raw}"),
        );
    };
    if !hosts.contains(&hostname) {
        return rpc_error(
            StatusCode::FORBIDDEN,
            -32000,
            format!("Invalid Host: {hostname}"),
        );
    }
    next.run(request).await
}

/// The hostname in a `Host` header, lowercased and without its port; IPv6 keeps its brackets.
pub fn hostname_of(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let (host, port) = if raw.starts_with('[') {
        let close = raw.find(']')?;
        let rest = &raw[close + 1..];
        let port = if rest.is_empty() {
            ""
        } else {
            rest.strip_prefix(':')?
        };
        (&raw[..=close], port)
    } else {
        raw.split_once(':').unwrap_or((raw, ""))
    };
    let host_ok =
        !host.is_empty() && !host.contains(|c: char| c.is_whitespace() || "/?#@\\".contains(c));
    let port_ok = port.bytes().all(|b| b.is_ascii_digit());
    (host_ok && port_ok && (raw.starts_with('[') || !host.contains(']')))
        .then(|| host.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostnames_lose_their_port_and_keep_ipv6_brackets() {
        assert_eq!(
            hostname_of("Example.TEST:8080").as_deref(),
            Some("example.test")
        );
        assert_eq!(hostname_of("localhost").as_deref(), Some("localhost"));
        assert_eq!(hostname_of("[::1]:3000").as_deref(), Some("[::1]"));
        assert_eq!(hostname_of("[::1]").as_deref(), Some("[::1]"));
        assert_eq!(hostname_of("a:b:c"), None);
        assert_eq!(hostname_of("[::1"), None);
        assert_eq!(hostname_of(""), None);
        assert_eq!(hostname_of("user@host"), None);
    }

    #[test]
    fn an_allow_list_of_separators_is_unset() {
        assert!(parse_allowed_hosts(None).is_empty());
        assert!(parse_allowed_hosts(Some(" , , ")).is_empty());
        assert_eq!(
            parse_allowed_hosts(Some("a.test, b.test")),
            vec!["a.test", "b.test"]
        );
    }

    #[test]
    fn the_body_limit_is_four_megabytes() {
        assert_eq!(BODY_LIMIT_BYTES, 4 * 1024 * 1024);
    }

    #[test]
    fn content_types() {
        assert!(is_json(Some(&HeaderValue::from_static("application/json"))));
        assert!(is_json(Some(&HeaderValue::from_static(
            "Application/JSON; charset=utf-8"
        ))));
        assert!(!is_json(Some(&HeaderValue::from_static("text/plain"))));
        assert!(!is_json(None));
    }
}
