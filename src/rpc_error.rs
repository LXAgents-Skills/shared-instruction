//! The JSON-RPC error envelope.
//!
//! The one shape every refusal on this server uses: the routes, the guards, and the bearer-token
//! check. It is the same envelope a client parses for a successful response, so a client never
//! has to branch on content type to find out it was refused.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// A JSON-RPC error response with `status`, `code` and `message`, and `id: null`.
pub fn rpc_error(status: StatusCode, code: i64, message: impl Into<String>) -> Response {
    let body = json!({ "jsonrpc": "2.0", "error": { "code": code, "message": message.into() }, "id": null });
    (status, Json(body)).into_response()
}
