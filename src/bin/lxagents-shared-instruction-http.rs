//! `lxagents-shared-instruction-http`: the HTTP server, whatever `MCP_TRANSPORT` says.

use std::process::ExitCode;

use lxagents_shared_instruction::http;

fn main() -> ExitCode {
    let Some(set) = lxagents_shared_instruction::boot() else {
        return ExitCode::FAILURE;
    };
    http::run(http::HttpConfig::from_env(), set)
}
