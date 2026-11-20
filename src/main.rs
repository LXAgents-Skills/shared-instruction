//! `lxagents-shared-instruction`: the server a client spawns.
//!
//! stdio by default. `MCP_TRANSPORT=http` (or `streamable-http`) runs the HTTP transport
//! instead, the same one `lxagents-shared-instruction-http` runs. This is the only variable read
//! here; the HTTP path reads its own five.

use std::process::ExitCode;

use lxagents_shared_instruction::{http, stdio};

fn main() -> ExitCode {
    let Some(set) = lxagents_shared_instruction::boot() else {
        return ExitCode::FAILURE;
    };
    let transport = std::env::var("MCP_TRANSPORT")
        .unwrap_or_else(|_| "stdio".into())
        .to_lowercase();
    if transport == "http" || transport == "streamable-http" {
        http::run(http::HttpConfig::from_env(), set)
    } else {
        stdio::run(set)
    }
}
