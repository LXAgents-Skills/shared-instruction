//! The HTTP transport over a real socket: the routes, the transport, and isolation between
//! requests.

mod common;

use std::collections::BTreeSet;
use std::thread;

use common::{Server, StdioClient, TEST_TOKEN, expected_tools, text_of};
use lxagents_shared_instruction::instructions::tool_id;
use lxagents_shared_instruction::version::SERVER_NAME;
use serde_json::json;

#[test]
fn the_health_check_answers_without_a_session() {
    let server = Server::http();
    let response = server.request("GET", "/healthz").send();
    let body = response.json();
    assert_eq!(response.status, 200);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["server"], SERVER_NAME);
    let version = body["version"].as_str().unwrap();
    assert_eq!(version.split('.').count(), 3, "{version}");
}

#[test]
fn the_startup_line_names_the_interface_it_bound() {
    let server = Server::http();
    assert!(server.output().contains(&format!(
        "serving Skill MCP over http on :{}/mcp (127.0.0.1)",
        server.port
    )));
}

#[test]
fn a_server_process_writes_nothing_to_stdout() {
    let server = Server::http();
    server.rpc("tools/list", json!({}));
    text_of(&server.rpc(
        "tools/call",
        json!({ "name": tool_id("branching_strategy"), "arguments": {} }),
    ));
    assert_eq!(server.stdout.text(), "", "stdout must stay empty");
    assert!(
        !server.output().is_empty(),
        "the startup line went to stderr"
    );
}

#[test]
fn the_http_transport_serves_the_same_tools_as_stdio() {
    let server = Server::http();
    let over_http = server.rpc("tools/list", json!({}))["result"]["tools"]
        .as_array()
        .unwrap()
        .clone();
    let over_stdio = StdioClient::main().tools();
    assert_eq!(
        over_http.len(),
        expected_tools(),
        "every tool reaches the HTTP transport"
    );
    assert_eq!(
        over_http, over_stdio,
        "names, descriptions and schemas agree tool for tool"
    );
    for tool in &over_http {
        assert_eq!(
            tool["inputSchema"]["properties"],
            json!({}),
            "{} must take no argument",
            tool["name"]
        );
    }
}

#[test]
fn a_tool_call_over_http_returns_the_file_byte_identically() {
    let server = Server::http();
    let mut stdio = StdioClient::main();
    for base in ["automation", "plan_creator", "github_api"] {
        let name = tool_id(base);
        let over_http =
            text_of(&server.rpc("tools/call", json!({ "name": name, "arguments": {} })));
        assert_eq!(over_http, stdio.text(&name), "{name}");
    }
}

#[test]
fn initialize_works_over_http_and_names_this_server() {
    let server = Server::http();
    let init = server.rpc("initialize", json!({
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "http-test", "version": "0.0.0" }
    }));
    assert_eq!(init["result"]["serverInfo"]["name"], SERVER_NAME);
    assert!(
        init["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains(&tool_id("automation"))
    );
    assert!(init["result"]["capabilities"]["tools"].is_object());
}

#[test]
fn an_unknown_route_says_what_this_server_does_not_serve() {
    let server = Server::http();
    let response = server.request("GET", "/nope").bearer(TEST_TOKEN).send();
    let body = response.json();
    assert_eq!(response.status, 404);
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["error"]["code"], -32601);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Not found: /nope")
    );
    assert!(!body.to_string().to_lowercase().contains("sse"));
}

#[test]
fn get_mcp_is_refused_rather_than_served() {
    let server = Server::http();
    for method in ["GET", "DELETE", "PUT"] {
        let response = server.request(method, "/mcp").bearer(TEST_TOKEN).send();
        let body = response.json();
        assert_eq!(response.status, 405, "{method}");
        assert_eq!(body["error"]["code"], -32000);
        assert_eq!(
            body["error"]["message"],
            format!("{method} is not supported in stateless mode")
        );
    }
}

#[test]
fn the_routes_the_sse_transport_used_are_gone() {
    let server = Server::http();
    for path in ["/sse", "/message"] {
        let response = server
            .request("POST", path)
            .list_tools()
            .bearer(TEST_TOKEN)
            .send();
        assert_eq!(response.status, 404, "{path} must not be served");
        assert_eq!(response.json()["error"]["code"], -32601);
    }
}

#[test]
fn concurrent_requests_do_not_share_state() {
    let server = Server::start(common::HTTP, &[("MCP_CLUSTER_WORKERS", "4")]);
    let port = server.port;
    let tools = ["commit_conventions", "plan_creator", "versioning"];
    let handles: Vec<_> = (0..30)
        .map(|i| {
            let base = tools[i % tools.len()];
            thread::spawn(move || {
                let response = common::Req::new(port, "POST", "/mcp")
                    .mcp()
                    .bearer(TEST_TOKEN)
                    .json(&json!({ "jsonrpc": "2.0", "id": i, "method": "tools/call", "params": { "name": tool_id(base), "arguments": {} } }))
                    .send();
                (base, text_of(&response.json()))
            })
        })
        .collect();
    let mut answered = BTreeSet::new();
    for handle in handles {
        let (base, text) = handle.join().unwrap();
        assert!(
            text.contains(&format!("name: {}", base.replace('_', "-"))),
            "{base} was answered with another request's file"
        );
        answered.insert(base);
    }
    assert_eq!(answered.len(), tools.len());
}
