//! The HTTP transport over a real socket: the body limit, parse errors, and headers no response
//! may carry.

mod common;

use common::{Server, TEST_TOKEN};
use lxagents_shared_instruction::app::BODY_LIMIT_BYTES;
use lxagents_shared_instruction::instructions::tool_id;
use serde_json::json;

#[test]
fn a_body_over_the_limit_is_refused_and_says_so_in_the_json_rpc_envelope() {
    let server = Server::http();
    let oversized = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": tool_id("branching_strategy"), "arguments": {}, "padding": "x".repeat(BODY_LIMIT_BYTES) }
    })
    .to_string();
    assert!(oversized.len() > BODY_LIMIT_BYTES);

    let response = server
        .request("POST", "/mcp")
        .header("Content-Type", "application/json")
        .bearer(TEST_TOKEN)
        .body(oversized)
        .send();
    let body = response.json();
    assert_eq!(response.status, 400);
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["error"]["code"], -32700);
}

#[test]
fn malformed_json_is_refused_with_exactly_the_same_answer_as_a_body_that_is_too_large() {
    let server = Server::http();
    let response = server
        .request("POST", "/mcp")
        .header("Content-Type", "application/json")
        .bearer(TEST_TOKEN)
        .body("{ this is not json")
        .send();
    let body = response.json();
    assert_eq!(response.status, 400);
    assert_eq!(body["error"]["code"], -32700);
    assert_eq!(
        body["error"]["message"],
        "Parse error: request body is not valid JSON"
    );
}

#[test]
fn no_response_advertises_the_framework_serving_it() {
    let server = Server::http();
    let responses = [
        server.request("GET", "/healthz").send(),
        server.request("GET", "/nope").bearer(TEST_TOKEN).send(),
        server.request("GET", "/mcp").bearer(TEST_TOKEN).send(),
        server.request("GET", "/mcp").send(),
    ];
    for response in responses {
        assert_eq!(response.header("x-powered-by"), None, "{response:?}");
        assert_eq!(response.header("server"), None, "{response:?}");
    }
}
