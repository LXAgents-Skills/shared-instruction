//! The HTTP transport over a real socket: the `Host` allow-list.

mod common;

use common::{HTTP, Server};

#[test]
fn with_no_allow_list_set_nothing_is_refused() {
    let server = Server::http();
    for host in ["example.test", "evil.test", "127.0.0.1"] {
        assert_eq!(
            server.request("GET", "/healthz").host(host).send().status,
            200,
            "{host} must be served"
        );
    }
}

#[test]
fn the_startup_line_announces_that_no_allow_list_is_applied() {
    let server = Server::http();
    assert!(server.wait_for("MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied"));
}

#[test]
fn the_allow_list_is_applied_when_mcp_allowed_hosts_is_set() {
    let server = Server::start(
        HTTP,
        &[(
            "MCP_ALLOWED_HOSTS",
            "shared-instruction.example.test, other.example.test",
        )],
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("shared-instruction.example.test")
            .send()
            .status,
        200
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("other.example.test")
            .send()
            .status,
        200
    );

    let refused = server.request("GET", "/healthz").host("evil.test").send();
    assert_eq!(refused.status, 403);
    assert!(
        refused.json()["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Invalid Host: evil.test")
    );

    let with_port = format!("shared-instruction.example.test:{}", server.port);
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host(&with_port)
            .send()
            .status,
        200,
        "the port is not part of the match"
    );
}

#[test]
fn the_allow_list_guards_the_health_check_too() {
    let server = Server::start(
        HTTP,
        &[("MCP_ALLOWED_HOSTS", "shared-instruction.example.test")],
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("evil.test")
            .send()
            .status,
        403
    );
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("shared-instruction.example.test")
            .send()
            .status,
        200
    );
}

#[test]
fn setting_mcp_allowed_hosts_silences_the_warning() {
    let server = Server::start(
        HTTP,
        &[("MCP_ALLOWED_HOSTS", "shared-instruction.example.test")],
    );
    assert!(server.wait_for("bearer token required on every route"));
    assert!(!server.output().contains("MCP_ALLOWED_HOSTS is unset"));
}

#[test]
fn an_allow_list_of_nothing_but_separators_still_counts_as_unset() {
    let server = Server::start(HTTP, &[("MCP_ALLOWED_HOSTS", " , , ")]);
    assert_eq!(
        server
            .request("GET", "/healthz")
            .host("anything.test")
            .send()
            .status,
        200
    );
    assert!(server.wait_for("MCP_ALLOWED_HOSTS is unset"));
}
