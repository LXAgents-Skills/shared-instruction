//! The HTTP entry point: its configuration, the port, the runtime, and the drain.
//!
//! The application itself is in `src/app.rs`, which builds a router and does not listen. This
//! file reads the environment once, refuses to start without a usable token off loopback,
//! binds, says what it bound, and shuts down in order.
//!
//! **Node's cluster became Tokio's thread pool.** The TypeScript server forked one process per
//! CPU, each binding the port through the cluster's shared handle. Here one process binds once
//! and `MCP_CLUSTER_WORKERS` sets how many runtime threads answer, so there is one listener, one
//! startup line, and no worker to respawn or orphan.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::app::{AppOptions, InFlight, LOOPBACK_HOSTNAMES, create_app, parse_allowed_hosts};
use crate::auth::{MIN_TOKEN_LENGTH, configured_token, is_loopback_host, startup_token_problem};
use crate::instructions::InstructionSet;
use crate::log::log;
use crate::version::{SERVER_NAME, VERSION};

/// How long a drain waits for in-flight requests before it stops waiting.
const DRAIN_GRACE: Duration = Duration::from_secs(5);

/// Everything the HTTP transport reads from the environment, read once.
#[derive(Debug, Clone)]
pub struct HttpConfig {
    /// `PORT`, default 3000.
    pub port: u16,
    /// `HOST`, default `0.0.0.0`.
    pub host: String,
    /// `MCP_AUTH_TOKEN`, trimmed; empty when unset.
    pub token: String,
    /// `MCP_ALLOWED_HOSTS`, split; empty when unset.
    pub allowed_hosts: Vec<String>,
    /// `MCP_CLUSTER_WORKERS`, when it is a count of at least 1.
    pub workers: Option<usize>,
}

impl HttpConfig {
    /// Read the five HTTP variables from the process environment.
    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var(name).ok();
        Self::from_vars(
            var("PORT").as_deref(),
            var("HOST").as_deref(),
            var("MCP_AUTH_TOKEN").as_deref(),
            var("MCP_ALLOWED_HOSTS").as_deref(),
            var("MCP_CLUSTER_WORKERS").as_deref(),
        )
    }

    /// The configuration the raw values describe.
    ///
    /// A port that is not a number, or is 0, is the default. A worker count below 1 is not a
    /// count and is ignored rather than clamped: `0` reads as "I did not mean to set this", not
    /// as "run nothing".
    pub fn from_vars(
        port: Option<&str>,
        host: Option<&str>,
        token: Option<&str>,
        allowed_hosts: Option<&str>,
        workers: Option<&str>,
    ) -> Self {
        Self {
            port: port
                .and_then(|value| value.trim().parse().ok())
                .filter(|&port| port != 0)
                .unwrap_or(3000),
            host: host
                .filter(|value| !value.is_empty())
                .unwrap_or("0.0.0.0")
                .to_string(),
            token: configured_token(token),
            allowed_hosts: parse_allowed_hosts(allowed_hosts),
            workers: workers
                .and_then(|value| value.trim().parse().ok())
                .filter(|&count| count >= 1),
        }
    }

    /// Whether this bind is a local install, reachable only from this machine.
    pub fn local_only(&self) -> bool {
        is_loopback_host(&self.host)
    }

    /// How many runtime threads answer: the configured count, else the CPUs this process has.
    pub fn worker_count(&self) -> usize {
        self.workers
            .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, usize::from))
    }
}

/// Serve `set` over HTTP with `config` until a signal stops it.
pub fn run(config: HttpConfig, set: Arc<InstructionSet>) -> ExitCode {
    // Fail closed, before anything binds. HTTP without a token is an open door on a network.
    if let Some(problem) = startup_token_problem(&config.host, &config.token) {
        log(&format!(
            "{SERVER_NAME} {VERSION} will not start the HTTP transport on {}: {problem}. Set MCP_AUTH_TOKEN to a secret of at least {MIN_TOKEN_LENGTH} characters, for example the output of: openssl rand -hex 32. stdio needs no token, and neither does HTTP on HOST=127.0.0.1 when MCP_AUTH_TOKEN is unset.",
            config.host
        ));
        return ExitCode::FAILURE;
    }

    let workers = config.worker_count();
    let runtime = match build_runtime(workers) {
        Ok(runtime) => runtime,
        Err(error) => {
            log(&format!(
                "{SERVER_NAME} {VERSION} cannot start its runtime: {error}"
            ));
            return ExitCode::FAILURE;
        }
    };
    log_worker_count(&config, workers);
    runtime.block_on(serve(config, set))
}

/// A single-threaded runtime for one worker, a pool for more.
fn build_runtime(workers: usize) -> std::io::Result<tokio::runtime::Runtime> {
    if workers <= 1 {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
    } else {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(workers)
            .enable_all()
            .build()
    }
}

/// Which of the two settings produced the count, named, because "MCP_CLUSTER_WORKERS is 1" is a
/// false statement about a machine that simply has one CPU.
fn log_worker_count(config: &HttpConfig, workers: usize) {
    if workers > 1 {
        log(&format!(
            "{SERVER_NAME} {VERSION} running {workers} HTTP worker threads on :{}/mcp",
            config.port
        ));
        return;
    }
    let why = match config.workers {
        Some(count) => format!("MCP_CLUSTER_WORKERS is {count}"),
        None => format!("available_parallelism() is {workers}"),
    };
    log(&format!(
        "{SERVER_NAME} {VERSION} {why}, so the HTTP server runs on a single thread."
    ));
}

/// Bind, announce, serve, and drain.
async fn serve(config: HttpConfig, set: Arc<InstructionSet>) -> ExitCode {
    let in_flight = InFlight::default();
    let shutdown = CancellationToken::new();
    let options = AppOptions {
        token: config.token.clone(),
        require_token: !config.local_only(),
        allowed_hosts: config.allowed_hosts.clone(),
        in_flight: in_flight.clone(),
        shutdown: shutdown.clone(),
    };
    let app = match create_app(set, options) {
        Ok(app) => app,
        Err(problem) => {
            log(&format!("{SERVER_NAME} {VERSION} {problem}"));
            return ExitCode::FAILURE;
        }
    };

    let bind_host = config
        .host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let listener = match TcpListener::bind((bind_host.as_str(), config.port)).await {
        Ok(listener) => listener,
        Err(error) => {
            log(&format!(
                "{SERVER_NAME} {VERSION} cannot bind {}:{}: {error}",
                config.host, config.port
            ));
            return ExitCode::FAILURE;
        }
    };
    announce(&config);

    tokio::spawn(drain_on_signal(in_flight, shutdown.clone()));
    let stopped = shutdown.clone();
    match axum::serve(listener, app)
        .with_graceful_shutdown(async move { stopped.cancelled().await })
        .await
    {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            log(&format!("{SERVER_NAME} {VERSION} stopped serving: {error}"));
            ExitCode::FAILURE
        }
    }
}

/// The startup lines: what was bound, and which guard is on. None ever carries the token.
fn announce(config: &HttpConfig) {
    let place = if config.host == "0.0.0.0" {
        "all interfaces"
    } else {
        config.host.as_str()
    };
    log(&format!(
        "{SERVER_NAME} {VERSION} serving Skill MCP over http on :{}/mcp ({place})",
        config.port
    ));

    if !config.token.is_empty() {
        log(&format!(
            "{SERVER_NAME} {VERSION} bearer token required on every route except GET /healthz."
        ));
    } else {
        log(&format!(
            "{SERVER_NAME} {VERSION} no bearer token: {} is loopback, so only this machine can connect. Set MCP_AUTH_TOKEN to require one, and never put a proxy in front of this without it.",
            config.host
        ));
    }

    // Said out loud, because the default is the unguarded one.
    if config.allowed_hosts.is_empty() && config.local_only() && config.token.is_empty() {
        log(&format!(
            "{SERVER_NAME} {VERSION} MCP_ALLOWED_HOSTS is unset, so the Host header must be one of {}.",
            LOOPBACK_HOSTNAMES.join(", ")
        ));
    } else if config.allowed_hosts.is_empty() {
        log(&format!(
            "{SERVER_NAME} {VERSION} MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied."
        ));
    }
}

/// Shutdown, in order: stop accepting, let in-flight requests finish, and stop waiting after
/// [`DRAIN_GRACE`]. A second signal means the operator has stopped waiting, and exits at once.
async fn drain_on_signal(in_flight: InFlight, shutdown: CancellationToken) {
    let signal = next_signal().await;
    log(&format!(
        "{signal}, draining {} in-flight request(s)",
        in_flight.count()
    ));
    shutdown.cancel();

    tokio::select! {
        _ = next_signal() => {}
        _ = tokio::time::sleep(DRAIN_GRACE) => {}
    }
    std::process::exit(0);
}

/// The name of the next SIGINT or SIGTERM.
#[cfg(unix)]
async fn next_signal() -> &'static str {
    use tokio::signal::unix::{SignalKind, signal};
    let (Ok(mut interrupt), Ok(mut terminate)) = (
        signal(SignalKind::interrupt()),
        signal(SignalKind::terminate()),
    ) else {
        std::future::pending::<()>().await;
        unreachable!();
    };
    tokio::select! {
        _ = interrupt.recv() => "SIGINT",
        _ = terminate.recv() => "SIGTERM",
    }
}

/// The name of the next Ctrl-C, where there are no Unix signals.
#[cfg(not(unix))]
async fn next_signal() -> &'static str {
    let _ = tokio::signal::ctrl_c().await;
    "SIGINT"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults() {
        let config = HttpConfig::from_vars(None, None, None, None, None);
        assert_eq!(config.port, 3000);
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.token, "");
        assert!(config.allowed_hosts.is_empty());
        assert_eq!(config.workers, None);
        assert!(!config.local_only());
        assert!(config.worker_count() >= 1);
    }

    #[test]
    fn values_that_are_not_counts_are_ignored() {
        for raw in ["0", "-1", "two", ""] {
            assert_eq!(
                HttpConfig::from_vars(None, None, None, None, Some(raw)).workers,
                None,
                "{raw}"
            );
        }
        assert_eq!(
            HttpConfig::from_vars(None, None, None, None, Some("2")).worker_count(),
            2
        );
        assert_eq!(
            HttpConfig::from_vars(Some("0"), None, None, None, None).port,
            3000
        );
        assert_eq!(
            HttpConfig::from_vars(Some("8080"), Some(""), None, None, None).port,
            8080
        );
        assert_eq!(
            HttpConfig::from_vars(None, Some(""), None, None, None).host,
            "0.0.0.0"
        );
    }

    #[test]
    fn a_loopback_host_is_local() {
        assert!(HttpConfig::from_vars(None, Some("127.0.0.1"), None, None, None).local_only());
        assert!(HttpConfig::from_vars(None, Some("[::1]"), None, None, None).local_only());
    }
}
