//! The stdio entry point: one connection, over this process's stdin and stdout.
//!
//! Never reads `MCP_AUTH_TOKEN`. A pipe a client spawns on its own machine has nobody to
//! authenticate.

use std::process::ExitCode;
use std::sync::Arc;

use rmcp::ServiceExt;

use crate::instructions::InstructionSet;
use crate::log::log;
use crate::server::InstructionServer;
use crate::version::{SERVER_NAME, VERSION};

/// Serve `set` over stdio until the client closes stdin or the process gets SIGINT.
pub fn run(set: Arc<InstructionSet>) -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            log(&format!(
                "{SERVER_NAME} {VERSION} cannot start its runtime: {error}"
            ));
            return ExitCode::FAILURE;
        }
    };

    runtime.block_on(async move {
        let service = match InstructionServer::new(set)
            .serve(rmcp::transport::stdio())
            .await
        {
            Ok(service) => service,
            Err(error) => {
                log(&format!(
                    "{SERVER_NAME} {VERSION} stdio handshake failed: {error}"
                ));
                return ExitCode::FAILURE;
            }
        };
        tokio::select! {
            _ = service.waiting() => ExitCode::SUCCESS,
            _ = tokio::signal::ctrl_c() => ExitCode::SUCCESS,
        }
    })
}
