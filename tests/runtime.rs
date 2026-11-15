//! The two binaries, the transport selection, the worker threads, and shutdown.
//!
//! These replace the TypeScript cluster suite. Node forked one process per worker; Rust runs one
//! process with a pool of runtime threads, so what is pinned is the thread count, one listener,
//! and the drain — not respawning or orphaned processes, which no longer exist.

mod common;

use std::time::Duration;

use common::{HTTP, MAIN, READY, Server, StdioClient, expected_tools};
use lxagents_shared_instruction::instructions::tool_id;
use serde_json::json;

#[test]
fn mcp_transport_http_reaches_the_same_server_through_the_main_binary() {
    let server = Server::start(MAIN, &[("MCP_TRANSPORT", "http")]);
    assert!(server.output().contains(&format!(
        "serving Skill MCP over http on :{}/mcp",
        server.port
    )));
    let tools = server.rpc("tools/list", json!({}));
    assert_eq!(
        tools["result"]["tools"].as_array().unwrap().len(),
        expected_tools()
    );
    assert_eq!(server.stdout.text(), "", "stdout must stay empty");
}

#[test]
fn streamable_http_is_accepted_as_a_transport_name_too() {
    let server = Server::start(MAIN, &[("MCP_TRANSPORT", "Streamable-HTTP")]);
    assert_eq!(server.request("GET", "/healthz").send().status, 200);
}

#[test]
fn the_main_binary_still_speaks_stdio_and_writes_nothing_but_protocol_to_stdout() {
    let mut client =
        StdioClient::connect(MAIN, &[("MCP_TRANSPORT", "stdio"), ("MCP_AUTH_TOKEN", "")]);
    assert_eq!(
        client.tools().len(),
        expected_tools(),
        "stdio serves the whole surface"
    );
    assert!(!client.text(&tool_id("plan_creator")).is_empty());
    // Every stdout line was parsed as JSON-RPC by the client; stderr names no HTTP server.
    let stderr = client.stderr.text();
    assert!(!stderr.contains(READY), "{stderr}");
    assert!(!stderr.contains("HTTP worker threads"), "{stderr}");
}

#[test]
fn mcp_cluster_workers_1_runs_on_a_single_thread() {
    let server = Server::start(HTTP, &[("MCP_CLUSTER_WORKERS", "1")]);
    assert!(
        server
            .output()
            .contains("MCP_CLUSTER_WORKERS is 1, so the HTTP server runs on a single thread.")
    );
    assert!(!server.output().contains("HTTP worker threads"));
    assert_eq!(server.count(READY), 1, "one listener, one startup line");
    let tools = server.rpc("tools/list", json!({}));
    assert_eq!(
        tools["result"]["tools"].as_array().unwrap().len(),
        expected_tools()
    );
}

#[test]
fn mcp_cluster_workers_2_runs_two_threads_behind_one_listener() {
    let server = Server::start(HTTP, &[("MCP_CLUSTER_WORKERS", "2")]);
    assert!(server.output().contains(&format!(
        "running 2 HTTP worker threads on :{}/mcp",
        server.port
    )));
    assert_eq!(server.count(READY), 1, "one listener, however many threads");
    assert_eq!(server.count("MCP_ALLOWED_HOSTS is unset"), 1);
    let threads =
        std::fs::read_dir(format!("/proc/{}/task", server.child.id())).map(|dir| dir.count());
    if let Ok(threads) = threads {
        assert!(
            threads >= 2,
            "expected at least two threads, found {threads}"
        );
    }
    for _ in 0..8 {
        assert_eq!(
            server.request("GET", "/healthz").send().json()["server"],
            "lxagents-shared-instruction"
        );
    }
}

#[test]
fn a_server_does_not_grow_across_many_requests() {
    let Ok(_) = std::fs::metadata("/proc/self/status") else {
        return;
    };
    let server = Server::start(HTTP, &[("MCP_CLUSTER_WORKERS", "1")]);
    let rss = || {
        let status =
            std::fs::read_to_string(format!("/proc/{}/status", server.child.id())).unwrap();
        let line = status
            .lines()
            .find(|line| line.starts_with("VmRSS:"))
            .unwrap();
        line.split_whitespace()
            .nth(1)
            .unwrap()
            .parse::<u64>()
            .unwrap()
            * 1024
    };
    let hammer = |times: usize| {
        for _ in 0..times {
            assert_eq!(
                server
                    .request("POST", "/mcp")
                    .list_tools()
                    .bearer(common::TEST_TOKEN)
                    .send()
                    .status,
                200
            );
        }
    };
    hammer(100);
    let before = rss();
    hammer(400);
    let growth = rss().saturating_sub(before);
    assert!(
        growth < 32 * 1024 * 1024,
        "the server grew {} MB over 400 requests",
        growth / 1024 / 1024
    );
}

#[cfg(unix)]
#[test]
fn a_shutdown_drains_and_stops_accepting() {
    let mut server = Server::http();
    server.signal("INT");
    let status = server
        .wait_exit(Duration::from_secs(10))
        .expect("the server did not exit");
    assert_eq!(status.code(), Some(0), "the handler did not run: {status}");
    assert!(
        server
            .output()
            .contains("SIGINT, draining 0 in-flight request(s)"),
        "{}",
        server.output()
    );
    assert!(
        server.request("GET", "/healthz").try_send().is_err(),
        "the port is no longer served"
    );
}

#[cfg(unix)]
#[test]
fn sigterm_drains_the_same_way() {
    let mut server = Server::start(HTTP, &[("MCP_CLUSTER_WORKERS", "2")]);
    server.signal("TERM");
    let status = server
        .wait_exit(Duration::from_secs(10))
        .expect("the server did not exit");
    assert_eq!(status.code(), Some(0));
    assert_eq!(server.count("SIGTERM, draining"), 1);
}

#[cfg(unix)]
#[test]
fn a_second_signal_stops_the_wait_rather_than_queueing_behind_the_first() {
    let mut server = Server::start(HTTP, &[("MCP_CLUSTER_WORKERS", "2")]);
    server.signal("INT");
    server.signal("INT");
    let status = server
        .wait_exit(Duration::from_secs(10))
        .expect("the server did not exit");
    assert_eq!(status.code(), Some(0));
    assert_eq!(
        server.count("SIGINT, draining"),
        1,
        "the drain line is written once"
    );
}

#[test]
fn a_broken_set_stops_both_binaries_before_any_transport_opens() {
    // The set is found beside the executable, so a copy of the binary next to an empty
    // `content/` is a server with nothing to publish.
    let dir = std::env::temp_dir().join(format!("lxagents-si-broken-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("bin")).unwrap();
    std::fs::create_dir_all(dir.join("content")).unwrap();
    for binary in [MAIN, HTTP] {
        let copy = dir
            .join("bin")
            .join(std::path::Path::new(binary).file_name().unwrap());
        std::fs::copy(binary, &copy).unwrap();
        let (code, output) = common::run_to_exit(copy.to_str().unwrap(), &[]);
        assert_eq!(code, Some(1), "{output}");
        assert!(output.contains("cannot load its set"), "{output}");
        assert!(!output.contains(READY), "{output}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
