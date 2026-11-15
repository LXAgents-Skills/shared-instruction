//! The HTTP transport over a real socket: authentication.

mod common;

use std::sync::Arc;

use common::{
    HTTP, MAIN, Server, StdioClient, TEST_TOKEN, content_dir, expected_tools, run_to_exit,
};
use lxagents_shared_instruction::app::{AppOptions, create_app};
use lxagents_shared_instruction::auth::MIN_TOKEN_LENGTH;
use lxagents_shared_instruction::instructions::InstructionSet;

#[test]
fn a_request_with_no_token_is_refused_with_a_401_the_client_can_read() {
    let server = Server::http();
    let response = server.request("POST", "/mcp").list_tools().send();
    let body = response.json();
    assert_eq!(response.status, 401);
    assert_eq!(
        response.header("www-authenticate"),
        Some("Bearer realm=\"mcp\"")
    );
    assert_eq!(body["jsonrpc"], "2.0");
    assert!(body["id"].is_null());
    assert_eq!(body["error"]["code"], -32001);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("send the token as Authorization: Bearer")
    );
}

#[test]
fn a_wrong_token_is_refused_whatever_its_length_and_never_with_a_500() {
    let server = Server::http();
    let one_off = format!(
        "{}{}",
        &TEST_TOKEN[..TEST_TOKEN.len() - 1],
        if TEST_TOKEN.ends_with('f') { "e" } else { "f" }
    );
    let wrong = [
        one_off,
        TEST_TOKEN[..TEST_TOKEN.len() - 1].to_string(),
        format!("{TEST_TOKEN}0"),
        TEST_TOKEN.to_uppercase(),
        "x".into(),
        "x".repeat(10_000),
    ];
    for token in wrong {
        let response = server
            .request("POST", "/mcp")
            .list_tools()
            .bearer(&token)
            .send();
        assert_eq!(
            response.status,
            401,
            "a {}-character token must be refused",
            token.len()
        );
        assert_eq!(
            response.header("www-authenticate"),
            Some("Bearer realm=\"mcp\", error=\"invalid_token\"")
        );
        assert!(
            response.json()["error"]["message"]
                .as_str()
                .unwrap()
                .contains("the token is not valid")
        );
    }
}

#[test]
fn only_a_bearer_credential_counts_and_the_scheme_is_case_insensitive() {
    let server = Server::http();
    for authorization in [
        format!("Basic {TEST_TOKEN}"),
        "Bearer".into(),
        format!("Bearer {TEST_TOKEN} {TEST_TOKEN}"),
        TEST_TOKEN.into(),
    ] {
        let response = server
            .request("POST", "/mcp")
            .list_tools()
            .header("Authorization", &authorization)
            .send();
        assert_eq!(response.status, 401, "{authorization:.12} must be refused");
    }
    let accepted = server
        .request("POST", "/mcp")
        .list_tools()
        .header("Authorization", &format!("bearer {TEST_TOKEN}"))
        .send();
    assert_eq!(
        accepted.status, 200,
        "RFC 7235 says the scheme is case-insensitive"
    );
}

#[test]
fn the_right_token_is_served() {
    let server = Server::http();
    let response = server
        .request("POST", "/mcp")
        .list_tools()
        .bearer(TEST_TOKEN)
        .send();
    assert_eq!(response.status, 200);
    assert!(response.body.contains("automation"));
}

#[test]
fn an_unauthenticated_caller_learns_nothing_about_which_routes_exist() {
    let server = Server::http();
    for (method, path) in [
        ("GET", "/mcp"),
        ("DELETE", "/mcp"),
        ("POST", "/nope"),
        ("GET", "/sse"),
        ("POST", "/message"),
    ] {
        assert_eq!(
            server.request(method, path).send().status,
            401,
            "{method} {path} must be refused, not routed"
        );
    }
}

#[test]
fn the_token_is_checked_before_the_body_is_read() {
    let server = Server::http();
    let response = server
        .request("POST", "/mcp")
        .header("Content-Type", "application/json")
        .body("{ this is not json")
        .send();
    assert_eq!(response.status, 401);
}

#[test]
fn only_get_healthz_is_open_and_the_exemption_is_exact() {
    let server = Server::http();
    assert_eq!(
        server.request("GET", "/healthz").send().status,
        200,
        "the probe needs no token"
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .bearer("wrong")
            .send()
            .status,
        200,
        "and a wrong token on it is not an error"
    );
    assert_eq!(server.request("POST", "/healthz").send().status, 401);
    assert_eq!(server.request("HEAD", "/healthz").send().status, 401);
    assert_eq!(server.request("GET", "/healthz/x").send().status, 401);
    assert_eq!(server.request("GET", "/healthzz").send().status, 401);
}

#[test]
fn the_allow_list_still_runs_before_the_token_check() {
    let server = Server::start(
        HTTP,
        &[("MCP_ALLOWED_HOSTS", "shared-instruction.example.test")],
    );
    assert_eq!(
        server
            .request("GET", "/mcp")
            .host("evil.test")
            .send()
            .status,
        403
    );
}

#[test]
fn the_startup_line_says_a_token_is_required_and_no_log_line_ever_carries_one() {
    let server = Server::http();
    assert!(server.wait_for("bearer token required on every route except GET /healthz"));
    let attempt = "wrong-token-that-must-not-be-logged-0123456789";
    server
        .request("POST", "/mcp")
        .list_tools()
        .bearer(attempt)
        .send();
    server
        .request("POST", "/mcp")
        .list_tools()
        .bearer(TEST_TOKEN)
        .send();
    let output = format!("{}{}", server.output(), server.stdout.text());
    assert!(
        !output.contains(TEST_TOKEN),
        "the real token must not be logged"
    );
    assert!(
        !output.contains(attempt),
        "a rejected token must not be logged"
    );
}

#[test]
fn a_token_with_a_trailing_newline_as_an_env_file_leaves_it_still_matches() {
    let server = Server::start(HTTP, &[("MCP_AUTH_TOKEN", &format!("{TEST_TOKEN}\n"))]);
    let tools = server.rpc("tools/list", serde_json::json!({}));
    assert_eq!(
        tools["result"]["tools"].as_array().unwrap().len(),
        expected_tools()
    );
}

#[test]
fn a_token_of_exactly_the_minimum_length_is_accepted() {
    let token = "k".repeat(MIN_TOKEN_LENGTH);
    let server = Server::start(HTTP, &[("MCP_AUTH_TOKEN", &token)]);
    assert_eq!(
        server
            .request("POST", "/mcp")
            .list_tools()
            .bearer(&token)
            .send()
            .status,
        200
    );
}

#[test]
fn http_off_loopback_refuses_to_start_without_a_usable_token() {
    let one_short = "k".repeat(MIN_TOKEN_LENGTH - 1);
    let cases = [
        ("unset", "", "MCP_AUTH_TOKEN is not set".to_string()),
        (
            "only whitespace",
            "  \n ",
            "MCP_AUTH_TOKEN is not set".to_string(),
        ),
        (
            "too short",
            "short-secret",
            "MCP_AUTH_TOKEN is 12 characters, and it must be at least 32".to_string(),
        ),
        (
            "one character short",
            one_short.as_str(),
            format!("is {} characters", MIN_TOKEN_LENGTH - 1),
        ),
    ];
    for (name, token, message) in cases {
        let (code, output) = run_to_exit(HTTP, &[("HOST", "0.0.0.0"), ("MCP_AUTH_TOKEN", token)]);
        assert_eq!(code, Some(1), "{name}: it must exit 1\n{output}");
        assert!(output.contains(&message), "{name}: {output}");
        assert!(
            output.contains("openssl rand -hex 32"),
            "{name}: the message must say how to fix it"
        );
        assert!(
            !output.contains(common::READY),
            "{name}: it must not have bound the port"
        );
        if !token.trim().is_empty() {
            assert!(
                !output.contains(token),
                "{name}: the value must not be echoed"
            );
        }
    }
}

#[test]
fn the_refusal_to_start_is_the_same_through_the_main_binary_and_printed_once() {
    for workers in ["", "3"] {
        let mut env = vec![
            ("MCP_TRANSPORT", "http"),
            ("HOST", "0.0.0.0"),
            ("MCP_AUTH_TOKEN", ""),
        ];
        if !workers.is_empty() {
            env.push(("MCP_CLUSTER_WORKERS", workers));
        }
        let (code, output) = run_to_exit(MAIN, &env);
        assert_eq!(code, Some(1), "{output}");
        assert_eq!(
            output.matches("will not start the HTTP transport").count(),
            1,
            "{output}"
        );
        assert!(!output.contains("HTTP worker threads"), "{output}");
    }
}

#[test]
fn http_on_loopback_starts_without_a_token_and_says_so() {
    let server = Server::start(HTTP, &[("MCP_AUTH_TOKEN", "")]);
    let response = server.request("POST", "/mcp").list_tools().send();
    assert_eq!(response.status, 200);
    assert!(response.body.contains("\"tools\""));
    assert!(server.wait_for("no bearer token"));
    assert!(
        server
            .output()
            .contains("no bearer token: 127.0.0.1 is loopback, so only this machine can connect")
    );
    assert!(!server.output().contains("bearer token required"));
}

#[test]
fn a_token_less_local_server_still_checks_the_host_header() {
    let server = Server::start(HTTP, &[("MCP_AUTH_TOKEN", "")]);
    assert_eq!(
        server
            .request("GET", "/mcp")
            .host("evil.example")
            .send()
            .status,
        403
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("localhost")
            .send()
            .status,
        200
    );
    assert!(server.wait_for("so the Host header must be one of"));
    assert!(
        server
            .output()
            .contains("must be one of localhost, 127.0.0.1, [::1]")
    );
    assert!(
        !server
            .output()
            .contains("no Host header allow-list is applied")
    );
}

#[test]
fn a_token_set_on_loopback_is_still_enforced_and_still_has_to_be_usable() {
    let server = Server::http();
    assert_eq!(
        server.request("POST", "/mcp").list_tools().send().status,
        401
    );
    drop(server);

    let (code, output) = run_to_exit(HTTP, &[("MCP_AUTH_TOKEN", "short-secret")]);
    assert_eq!(code, Some(1), "{output}");
    assert!(
        output.contains(
            "will not start the HTTP transport on 127.0.0.1: MCP_AUTH_TOKEN is 12 characters"
        ),
        "{output}"
    );
}

#[test]
fn the_app_cannot_be_built_without_a_usable_token() {
    let set = Arc::new(InstructionSet::load(&content_dir()).unwrap());
    let build = |token: &str, require_token: bool| {
        let mut options = AppOptions::with_token(token);
        options.require_token = require_token;
        create_app(set.clone(), options)
    };
    assert!(
        build("", true)
            .unwrap_err()
            .contains("Refusing to build the HTTP app: MCP_AUTH_TOKEN is not set")
    );
    assert!(
        build("short", true)
            .unwrap_err()
            .contains("must be at least 32")
    );
    assert!(
        build("", false).is_ok(),
        "the open form needs the explicit option"
    );
    assert!(
        build("short", false)
            .unwrap_err()
            .contains("must be at least 32"),
        "a token that was given is always checked"
    );
    assert!(build(TEST_TOKEN, true).is_ok());
}

#[test]
fn stdio_never_reads_the_token_so_even_an_unusable_one_does_not_stop_it() {
    let mut client =
        StdioClient::connect(MAIN, &[("MCP_TRANSPORT", "stdio"), ("MCP_AUTH_TOKEN", "x")]);
    assert_eq!(client.tools().len(), expected_tools());
}
