//! The LXAgents shared agent instruction set, served read-only over MCP: one tool per markdown
//! file in `content/`.
//!
//! The two binaries in `src/main.rs` and `src/bin/` are thin entry points. Everything they run
//! is here, one responsibility per module:
//!
//! | Module | Holds |
//! |---|---|
//! | [`version`] | The server's name, its version, and where `content/` is. |
//! | [`instructions`] | The tool surface, built from `content/` once at boot. |
//! | [`server`] | The MCP handler that serves that surface. |
//! | [`auth`] | The bearer-token rules for the HTTP transport. |
//! | [`rpc_error`] | The one JSON-RPC error envelope every refusal uses. |
//! | [`app`] | The HTTP application: routes and guards. It does not listen. |
//! | [`http`] | The HTTP entry point: configuration, the port, the runtime, the drain. |
//! | [`stdio`] | The stdio entry point. |
//! | [`log`] | Lines on stderr. Nothing in this crate writes to stdout. |

pub mod app;
pub mod auth;
pub mod http;
pub mod instructions;
pub mod log;
pub mod rpc_error;
pub mod server;
pub mod stdio;
pub mod version;

use std::sync::Arc;

/// Load the set from `content/`, or say why on stderr and return `None`.
///
/// Both binaries start here, so a malformed set fails the process before any transport opens.
pub fn boot() -> Option<Arc<instructions::InstructionSet>> {
    match instructions::InstructionSet::load(&version::content_dir()) {
        Ok(set) => Some(Arc::new(set)),
        Err(problem) => {
            log::log(&format!(
                "{} {} cannot load its set: {problem}",
                version::SERVER_NAME,
                version::VERSION
            ));
            None
        }
    }
}
