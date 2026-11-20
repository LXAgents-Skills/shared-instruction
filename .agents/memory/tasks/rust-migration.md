---
name: memory-tasks-rust-migration
description: Rewriting the server and its tests from TypeScript to Rust on the official MCP Rust SDK (rmcp) with axum for HTTP, with the tool surface byte-identical.
---

# Rust Migration

## 2026-11-14 — in progress

**Goal.** The server is written in Rust on `rmcp` (the official MCP Rust SDK) with `axum` for the
HTTP transport, with no change to what any client sees.

**Objective.** `cargo build --release` produces `lxagents-shared-instruction` (stdio, or HTTP on
`MCP_TRANSPORT=http`) and `lxagents-shared-instruction-http` (HTTP). `cargo test` passes a suite
that ports every behaviour the 74 TypeScript tests pinned. Every tool id, description and served
byte is unchanged, and so are the HTTP routes, error envelopes, `MCP_AUTH_TOKEN` rules, the `Host`
allow-list and the 4 MB body limit. No TypeScript, `package.json` or `node_modules` remains.

**Detail.** This repository only; `security`, `template` and `agentic` migrate in their own
threads. `content/` is not touched. The owner's request overrides the "`tsc` is the one build
step" and "three runtime dependencies" lines of `.agents/rules/repository.md`; that file is
rewritten for Rust in task 2.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/rust-migration` | |
| 2 | Rust server and tests | `refactor/rust-server` | |
| 3 | Documentation | `docs/rust-install` | |
| 4 | Release | `release/6.0.6` | |

## Decisions

| # | Decision |
|---|---|
| D1 | One crate: a library plus two binaries, one per former entry point (`dist/index.js`, `dist/http.js`). |
| D2 | Tools are registered by hand on `rmcp::ServerHandler`, generated from `content/` at boot; each takes `{"type":"object","properties":{}}`. |
| D3 | `content/` is read once at boot at run time, found from the executable's ancestors, falling back to the checkout the binary was built from. No new environment variable. |
| D4 | HTTP is stateless (`legacy_session_mode` off, JSON responses). This server's own middleware does the `Host` check, the token, and the 4 MB body read, in that order, ahead of rmcp's transport. |
| D5 | Node's cluster becomes the Tokio thread pool: `MCP_CLUSTER_WORKERS` sets the worker-thread count, 1 means a single-threaded runtime. One listener, one startup line. |
| D6 | `6.0.6`, a patch, by the owner's standing preference; the surface is byte-identical and the run command change is in the release log. |

## Task entries

### Task 1 — plan/rust-migration

Landed: this record and its row in `memory-index.md`.

### Task 2 — refactor/rust-server

Landed: `Cargo.toml` and `Cargo.lock`; `src/` as Rust (`lib.rs`, `version`, `instructions`,
`server`, `auth`, `rpc_error`, `app`, `http`, `stdio`, `log`, `main.rs`, and
`src/bin/lxagents-shared-instruction-http.rs`); `tests/` as Rust (`surface`, `http_auth`,
`http_hosts`, `http_limits`, `http_routes`, `runtime`, and `common/mod.rs`); the two-stage Rust
`Dockerfile` and its `.dockerignore`; `/target/` in `.gitignore`; `.agents/rules/repository.md`
rewritten for the Rust stack; the decision record `rust-rmcp-and-axum.md`, superseding the
express one. Deleted: `package.json`, `package-lock.json`, both `tsconfig` files, every `.ts`.

Verified: 87 tests pass (21 unit, 66 integration) and clippy is clean with `-D warnings`. A
stdio dump of all 49 tools from the 6.0.5 Node server and from this build matched exactly —
order, names, descriptions, input schemas, served text, and the server `instructions`.

Not ported, because the thing they tested no longer exists: worker respawn, an orphaned worker
after the primary is killed, and one startup line per forked process. Replaced by thread-count,
single-listener, SIGTERM and broken-set tests.

Not verified: the image build. This environment has the Docker client but no daemon.

Left for task 3: every page in `wiki/`, `README.md`, `AGENTS.md`, `.agents/wiki/` and
`.agents/rules/content-publishing.md` still describes Node, `npm` and `dist/`.
