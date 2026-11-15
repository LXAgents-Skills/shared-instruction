//! The MCP handler: the tool surface, served read-only.
//!
//! One [`InstructionServer`] per connection — a stdio pipe, or one HTTP request — over one
//! shared, immutable [`InstructionSet`]. The set is behind an `Arc` and never mutated, which is
//! what makes concurrent clients safe; the handler holds nothing else.
//!
//! Nothing here takes an argument, which is the point: there is no `path` for a caller to
//! traverse with and no verb for a caller to act on. The tools that would write the set are
//! absent, not disabled.

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    JsonObject, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use serde_json::{Map, Value};

use crate::instructions::{InstructionSet, tool_id};
use crate::version::{SERVER_NAME, VERSION};

/// The server's own instructions, sent in `initialize`. They send a session to the hub first.
pub fn server_instructions() -> String {
    format!(
        "The LXAgents shared agent instruction set, served as Skill MCP instructions, read-only. Read the `{}` tool once at the start of every session: it lists every tool and the condition that activates each. Call no other tool until its condition is true. Each tool is complete on its own and points to no other.",
        tool_id("automation")
    )
}

/// The input schema every tool advertises: an object with no properties.
fn no_arguments() -> Arc<JsonObject> {
    let mut schema = Map::new();
    schema.insert("type".into(), Value::from("object"));
    schema.insert("properties".into(), Value::Object(Map::new()));
    Arc::new(schema)
}

/// The handler for one connection.
#[derive(Clone)]
pub struct InstructionServer {
    set: Arc<InstructionSet>,
    listing: Arc<Vec<Tool>>,
}

impl InstructionServer {
    /// A handler over `set`. Cheap: the set and the tool listing are shared, not copied.
    pub fn new(set: Arc<InstructionSet>) -> Self {
        let schema = no_arguments();
        let listing = set
            .tools()
            .iter()
            .map(|tool| Tool::new(tool.name.clone(), tool.description.clone(), schema.clone()))
            .collect();
        Self {
            set,
            listing: Arc::new(listing),
        }
    }
}

impl ServerHandler for InstructionServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(SERVER_NAME, VERSION))
            .with_instructions(server_instructions())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(
            self.listing.as_ref().clone(),
        ))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let tool = self.set.get(&request.name).ok_or_else(|| {
            McpError::invalid_params(format!("Tool {} not found", request.name), None)
        })?;
        Ok(CallToolResult::success(vec![ContentBlock::text(tool.text.clone())]).into())
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.listing.iter().find(|tool| tool.name == name).cloned()
    }
}
