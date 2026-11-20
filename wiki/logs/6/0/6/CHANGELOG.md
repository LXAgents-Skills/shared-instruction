# 6.0.6

**Released:** 2026-11-20

**The server is Rust.** One crate, edition 2024, on the official MCP Rust SDK (`rmcp`) and
`axum`, replaces the TypeScript server. `cargo build --release` produces two binaries in
`target/release/`; `target/` is not committed.

**Nothing a client sees changes.** All 49 tool ids, their descriptions, their input schemas,
every body, the server name and the `initialize` instructions are identical to `6.0.5`
(compared over stdio, tool for tool). stdio stays the default, the HTTP routes, status codes
and error envelopes are the same, and the `MCP_AUTH_TOKEN` rule is unchanged: required for
HTTP off loopback, never read by stdio or by HTTP on loopback.

**Consumers must:** change a server config that runs a checkout from
`command: node`, `args: ["dist/index.js"]` to
`command: <checkout>/target/release/lxagents-shared-instruction` with no args and no cwd, after
running `cargo build --release` once in the checkout (Rust 1.88 or newer). The HTTP form is
`target/release/lxagents-shared-instruction-http`, or the main binary with `MCP_TRANSPORT=http`.
A client using the image pulls `6.0.6`; the HTTP form there is
`docker run … lxagents-shared-instruction:6.0.6 lxagents-shared-instruction-http`.

This is a patch, by the owner's standing preference, even though the run command changes.

## Added

- **`Cargo.toml` and `Cargo.lock`**: runtime dependencies `rmcp`, `tokio`, `tokio-util`,
  `axum`, `serde_json`, `sha2` and `subtle`.
- **`src/*.rs`**: the library (`boot()`, the instruction set, the handler, the HTTP
  application, the bearer token, the error envelope, stderr logging) and two binaries,
  `lxagents-shared-instruction` and `lxagents-shared-instruction-http`.
- **`tests/*.rs`**: six integration files that start the built binaries as child processes,
  plus unit tests beside the code.
- **Decision record** `.agents/memory/decisions/rust-rmcp-and-axum.md`.

## Changed

- **Worker threads replace worker processes.** One process, one listener, a Tokio runtime
  with one worker thread per CPU; `MCP_CLUSTER_WORKERS` sets the count and `1` is
  single-threaded. The log carries one `serving` line, not one per worker.
- **The HTTP transport is stateless** (no session id), with JSON responses.
- **The `Dockerfile`** builds in `rust:1.97-alpine` and runs on `alpine:3.22` as `USER mcp`,
  carrying the two binaries in `/srv/bin` and `content/` in `/srv/content`. Its default command
  is stdio; the HTTP binary is named after the image. The image has not been built: the
  environment had no Docker daemon.
- **The documentation**, `README.md`, `AGENTS.md` and the agent wiki and rules describe the
  cargo build and the binary paths.

## Removed

- **The TypeScript server**: `src/*.ts`, `test/*.ts`, `package.json`, `package-lock.json` and
  both tsconfigs. There is no `dist/`, no `npm install` and no `npx` form.

Tests: 87, all passing (21 unit, 66 integration). Clippy is clean with `-D warnings`. The
surface is 49 tools.
