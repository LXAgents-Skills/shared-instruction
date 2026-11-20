---
name: agent-wiki-context-repository-map
description: Orientation before touching this repository — what lives where, the commands, the entry points, and the gotchas that actually bite.
---

# Repository Map

Read this before changing anything here. Underlying facts live in `wiki/`; this page is
the agent-facing orientation and links out rather than restating.

## What this repository is

`LXAgents-Skills/shared-instruction` — an MCP server that serves the LXAgents shared agent
instruction set as `lxagents-shared-instruction`. Rust, edition 2024, one crate on the
official MCP Rust SDK (`rmcp`) and `axum`; `cargo build --release` produces two binaries in
`target/release/`.

It is both the **producer** of the shared set and a **consumer** of it. See
[`../../rules/repository.md`](../../rules/repository.md).

## What lives where

| Path | Contents | Touch it when |
|---|---|---|
| `content/` | The published instruction set — every markdown file is served as its own tool, and `automation.md` routes them. | You are changing a convention every repository follows. **This is a release.** |
| `.agents/` | This repository's own rules, indexes, agent wiki, memory. | You are changing something true only here. |
| `wiki/` | Human documentation, plus `wiki/logs/` release history. | A person needs to read it. |
| `src/instructions.rs` | `InstructionSet::load` builds the whole surface, one tool per file; `OVERRIDE_BASES`. | Adding or changing a tool. |
| `src/server.rs` | `InstructionServer`, the `rmcp::ServerHandler`; carries the `instructions` text. | Changing the MCP surface. |
| `src/version.rs` | `SERVER_NAME`, `VERSION` (from `Cargo.toml`), and where `content/` is. | Renaming the server or moving the set. |
| `src/app.rs` | The HTTP application — `POST /mcp`, `GET /healthz`, the 405, the 404, the body limit, the `Host` allow-list, the token. Builds and returns; does not listen. | The HTTP surface. |
| `src/auth.rs` | The bearer token: the strength check and the constant-time comparison. | Anything about who may call the HTTP transport. |
| `src/rpc_error.rs` | The one JSON-RPC error envelope every refusal uses. | Changing the shape of any refusal. |
| `src/http.rs` | The HTTP entry — configuration, the runtime and worker threads, the port, the startup lines, the drain. | A listening server, worker count, port, or shutdown. |
| `src/stdio.rs`, `src/main.rs`, `src/bin/` | The stdio entry, and the two binaries. | Transport selection. |
| `Dockerfile` | Two-stage image: `rust:1.97-alpine` builds, `alpine:3.22` runs as `USER mcp`. Default command is stdio. | The toolchain the image pins. |
| `tests/` | `surface.rs` (stdio), `http_{routes,hosts,limits,auth}.rs`, `runtime.rs`, sharing `common/mod.rs`, which starts the built binaries as child processes. | Always. Every behavioural change ships with one. |

## Entry points

* `target/release/lxagents-shared-instruction` — what an MCP client spawns. stdio by
  default; HTTP when `MCP_TRANSPORT=http`.
* `target/release/lxagents-shared-instruction-http` — always HTTP. One process, one
  listener, a Tokio runtime with one worker thread per CPU (`MCP_CLUSTER_WORKERS`
  overrides, `1` is single-threaded). **Off loopback it refuses to start without
  `MCP_AUTH_TOKEN`**, checked before the runtime is built.

Both call `boot()` in `src/lib.rs`, which loads the set or exits `1`.

## Commands

```bash
cargo build --release
cargo test
cargo clippy --all-targets -- -D warnings
target/release/lxagents-shared-instruction                                  # stdio
MCP_AUTH_TOKEN=<32+ chars> target/release/lxagents-shared-instruction-http  # HTTP on 0.0.0.0:3000
HOST=127.0.0.1 target/release/lxagents-shared-instruction-http              # loopback, no token
npx @modelcontextprotocol/inspector target/release/lxagents-shared-instruction
```

## Gotchas that actually bite

* **`content/` is published.** Adding a file there ships it to every consuming
  repository on the next boot as a new tool. See
  [`../../rules/content-publishing.md`](../../rules/content-publishing.md).
* **Content changes need a restart, not a rebuild.** The set is read once at boot.
* **Two files outside `content/` copy its text.** The root `AGENTS.md` and the
  `instructions` string in `src/server.rs`. Grep for a sentence you changed — see
  [`../../rules/set-mirrors.md`](../../rules/set-mirrors.md).
* **HTTP tests need a token.** `tests/common/mod.rs` hands every child `MCP_AUTH_TOKEN`
  and sends the matching header; a test that starts the server another way must do the same,
  or it reads a `401` as a failure of the thing it tests.
* **Nothing writes to stdout.** Every log line goes through `src/log.rs` to stderr; no
  `println!` in `src/`, no `tracing` subscriber.
* **Host tests send the header by hand.** The harness writes raw HTTP so the `Host` header
  is exactly what the test names; do not swap it for a client that rewrites it.
* **One handler per connection.** The HTTP service clones a template handler per request;
  per-connection state belongs to rmcp, never to the shared set.
* **Every tool declares the empty object schema** `{"type":"object","properties":{}}`, and
  no tool takes an argument. Adding one is a design decision, not a cleanup.
* **A file rename is a breaking change.** The tool name is derived from the filename.
* **Two files with the same basename collide**, and boot fails. Resolve it with an entry
  in `OVERRIDE_BASES`, not by renaming a file.

## Generated and vendored paths

`target/` only, and it is ignored. `.dockerignore` keeps `target`, `tests`, `wiki`,
`.agents` and the root markdown out of the image, which is why the image cannot run its own
suite. There is no compose file: a compose file encodes a deployment and this repository has
none.

## Where the shared set resolves from

`content/`, in the working tree — not the deployed connector. You are editing the set,
so the working tree is the authority.

## Further reading

* [`../../../wiki/information/architecture.md`](../../../wiki/information/architecture.md) — how the server is built and why.
* [`../../../wiki/reference/mcp-surface.md`](../../../wiki/reference/mcp-surface.md) — the tool surface, and what it deliberately does not expose.
* [`../../../wiki/environments/env.md`](../../../wiki/environments/env.md) — configuration.
* [`../security/security-boundaries.md`](../security/security-boundaries.md) — the security SOP, and the rule against carrying a security context between repositories.
