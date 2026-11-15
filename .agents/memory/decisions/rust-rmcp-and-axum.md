---
name: memory-decisions-rust-rmcp-and-axum
description: Why the server is Rust on rmcp and axum, what each runtime dependency is for, and how the Node shapes (two entry points, cluster, express middleware) were mapped.
---

# Rust on rmcp and axum

**Decision.** From 6.0.6 the server is a Rust crate. The MCP protocol is `rmcp` (the official
MCP Rust SDK, <https://github.com/modelcontextprotocol/rust-sdk>), and the HTTP transport is an
`axum` router. This supersedes
[`express-for-http-transport.md`](express-for-http-transport.md), which stays on disk as the
record of why the Node server looked the way it did.

**Why.** The owner asked for every repository in the organization to move to Rust on these two
crates, on 2026-11-14. The tool surface, the routes and the guards were to stay the same.

## The runtime dependencies, and what each is for

| Crate | For |
|---|---|
| `rmcp` | The protocol: `ServerHandler`, the stdio transport, and the stateless Streamable HTTP service. Features `server`, `transport-io`, `transport-streamable-http-server`. |
| `tokio` | The runtime both transports run on, and the signals the drain listens for. |
| `tokio-util` | The `CancellationToken` that tells rmcp's service the server is shutting down. |
| `axum` | The routes (`POST /mcp`, `GET /healthz`, the 405 and the 404), and the middleware for the `Host` allow-list and the token. |
| `serde_json` | JSON bodies: checking a request parses, and writing the error envelope and the health check. |
| `sha2`, `subtle` | The bearer-token check: both values hashed to fixed length, then compared in constant time. |

## How the Node shapes were mapped

* **Two entry points became two binaries**, one per former file, so the documented commands
  stay one-to-one: `lxagents-shared-instruction` for `dist/index.js`, and
  `lxagents-shared-instruction-http` for `dist/http.js`.
* **express middleware became this crate's own axum middleware**, in the same order: `Host`
  allow-list, token, body, routes. rmcp's built-in `Host` check is switched off, because it
  would run after the token with a different answer, and the TypeScript SDK's 403 envelope
  (`Invalid Host: <name>`, port ignored) is kept.
* **The body is read here, not by rmcp**, up to 4 MB and checked to parse, so an oversized body
  and a malformed one keep their single 400 / `-32700` answer.
* **The cluster became the Tokio thread pool.** `MCP_CLUSTER_WORKERS` keeps its name and sets the
  worker-thread count; `1` is a single-threaded runtime. One process binds once, so there is one
  startup line, and the respawn and orphan behaviours have no equivalent to keep.
* **Stateless, with JSON responses.** `legacy_session_mode` is off and `json_response` on: no
  session id is minted, and a simple call is answered as `application/json`. rmcp falls back to
  SSE on its own if a handler ever sends a message before its result.
* **`content/` is read at run time**, found from the executable's ancestors with the build
  checkout as a fallback, so adding a file still adds a tool on the next boot without a rebuild.
  No environment variable chooses the directory.
