---
name: repository-rules
description: Rules specific to LXAgents-Skills/shared-instruction — the dual producer/consumer role, the code conventions, and what must not be introduced.
---

# Repository Rules

Rules that are true of **this repository only**. Anything true of more than one
repository belongs in `content/` and is published — see
[`content-publishing.md`](content-publishing.md).

This file is a hub. It links out rather than restating, and it never repeats a rule
that `content/` already carries.

## This repository has two roles

| Role | Meaning |
|---|---|
| **Producer** | It holds the shared instruction set in `content/` and serves it over MCP as `lxagents-shared-instruction`. Editing `content/` changes behaviour in every consuming repository. |
| **Consumer** | It follows that same set, plus the local additions in `.agents/`. |

The two must not blur. `content/` is the product; `.agents/` is this repository's own
instruction set, exactly like any consuming repository's.

**When following the set here, `{shared}` resolves to `content/` in the working tree —
not to the deployed connector.** You are editing the set, so the working tree is the
authority; the deployed server is a snapshot that may be older than your branch.

## What lives where

| Path | Holds | Published? |
|---|---|---|
| `content/` | The shared instruction set. | **Yes** — one tool per file. |
| `.agents/` | This repository's own rules, indexes, agent wiki, memory. | No. |
| `wiki/` | This repository's human documentation. | No. |
| `src/`, `test/` | The server implementation and its tests. | No. |

Never put a repository-specific rule in `content/`, and never put a universal
convention in `.agents/`. The routing question is the one in
[`content/rules/directories.md`](../../content/rules/directories.md): *is this true for
more than this repository?*

## Stack and commands

Rust, edition 2024, on the official MCP Rust SDK (`rmcp`) with `axum` for the HTTP transport.
One crate: a library in `src/lib.rs` and two binaries. `cargo build` is the one build step; do
not add a `build.rs`, a code generator, or a second crate without agreement.

**`target/` is built, never committed.** `cargo build --release` in a fresh clone is what
produces the binaries; that is how the owner installs. Every runnable path — the client's
server config, the `Dockerfile`, the docs — names a binary under `target/release/` (or
`/srv/bin/` in the image), and every source path names `src/`.

| Binary | Replaces | Speaks |
|---|---|---|
| `lxagents-shared-instruction` | `dist/index.js` | stdio; HTTP when `MCP_TRANSPORT=http` |
| `lxagents-shared-instruction-http` | `dist/http.js` | HTTP |

| Task | Command |
|---|---|
| Build (release) | `cargo build --release` |
| Test | `cargo test` |
| Lint | `cargo clippy --all-targets -- -D warnings` |
| Format | `cargo fmt` |
| Run (stdio) | `target/release/lxagents-shared-instruction` |
| Run (HTTP) | `target/release/lxagents-shared-instruction-http` |
| Inspect the MCP surface | `npx @modelcontextprotocol/inspector target/release/lxagents-shared-instruction` |
| Build the image | `docker build -t lxagents-shared-instruction:<version> .` |
| Run the image (stdio) | `docker run --rm -i lxagents-shared-instruction:<version>` |
| Run the image (HTTP) | `docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-shared-instruction:<version> lxagents-shared-instruction-http` |

There is still no `compose.yaml`: a compose file encodes a deployment, and this repository has
none. See [`../wiki/environments/docker.md`](../wiki/environments/docker.md).

**`docker run` needs `-i`.** Without it Docker does not attach stdin, the server sees closed
input, and it exits immediately. It looks like a broken image and is not.

**The first `cargo test` in a checkout compiles everything**, which takes a minute or two and
needs crates.io. A test result is not a verdict on the code until that build has finished.

Full orientation: [`../wiki/context/repository-map.md`](../wiki/context/repository-map.md).

## Code conventions the codebase already follows

* **One responsibility per module**, named for it: `version`, `instructions`, `server`, `auth`,
  `rpc_error`, `app`, `http`, `stdio`, `log`. The binaries are thin and call the library.
* **The environment is read once, at the entry point.** `src/main.rs` reads `MCP_TRANSPORT`;
  `http::HttpConfig::from_env` reads the other five and passes values down. Nothing deeper reads
  a variable, which is what makes `auth` and `app` testable without one.
* **Nothing writes to stdout.** On the stdio transport stdout *is* the JSON-RPC channel, and the
  main binary can be either transport. Every log line goes through `log::log`, to stderr. There
  is no `println!` anywhere in `src/`, and no `tracing` subscriber is installed, so rmcp's own
  events go nowhere.
* **The set is read once at boot and never changed.** `InstructionSet` is built in `boot()` and
  shared behind an `Arc`; no per-request cache keyed on shared state.
* **Read set text from `content/`; never hard-code it.** A file's own frontmatter supplies its
  tool description. A hard-coded copy in `src/` is a new mirror; see
  [`set-mirrors.md`](set-mirrors.md).
* **One `InstructionServer` per connection.** The HTTP service factory clones a fresh handler for
  every request over the one shared set; never share a handler across connections.
* **Fail at boot, not at first call.** A name that is not a valid MCP identifier, two files
  deriving the same name, a stale override, or a missing `description` stop both binaries before
  any transport opens.
* **Comments explain why, not what.**

## Testing

Every behavioural change ships with a test, and `cargo test` must pass, with
`cargo clippy --all-targets -- -D warnings` clean, before any commit. Unit tests sit beside the
code they test; the integration suites in `tests/` start the **built binaries** as child
processes (`CARGO_BIN_EXE_*`), because that is what a client runs, and share a harness in
`tests/common/mod.rs`.

`tests/surface.rs` is the surface suite. `tests/http_*.rs`, one per subject, cover the HTTP
transport against a real listening process, and `tests/runtime.rs` covers the two binaries, the
worker threads and shutdown. Prefer a test that pins an invariant over one that pins a string:
files and tools are a bijection, no tool takes an argument, the bytes served equal the bytes on
disk, and the two transports agree tool for tool.

## What must not be introduced

* Build output committed to the repository, or a build step beyond `cargo build`.
* `unsafe`, or an `unwrap()` on a path a client can reach. A request that cannot be answered gets
  a JSON-RPC error, not a panic.
* A dependency added to serve one call site. The runtime dependencies are `rmcp`, `tokio`,
  `tokio-util`, `axum`, `serde_json`, `sha2` and `subtle`, reasoned in
  `.agents/memory/decisions/rust-rmcp-and-axum.md`. Another needs its own record there before it
  lands, not after.
* An argument on a tool. Every tool names one file, and the absence of a path is what makes
  traversal impossible.
* Filesystem or network I/O on the read path. Reads are lookups.
* A new listener, route, binary, or environment variable without a say-so. The server has two
  transports and six variables, and `wiki/environments/env.md` says what each does.
* A third documentation tree. `wiki/` and `.agents/wiki/` are the only two.
* Anything under `content/` that is not part of the published set.

## Deployment

Installed by cloning and running `cargo build --release`, and consumed mostly as a stdio
subprocess: a client's config names `target/release/lxagents-shared-instruction`. Nothing is
published to crates.io (`publish = false`) or npm any more.

`lxagents-shared-instruction-http` can also serve the same tools at `POST /mcp` for a client that
reaches a fixed address instead of spawning a process. **It is a capability, not a deployment** —
this repository routes nothing, names no host, and decides no ingress. The distinction matters
because a listener with no front door is a security claim, and
[`../wiki/security/security-model.md`](../wiki/security/security-model.md) is where that is
argued.

A `Dockerfile` exists to pin the toolchain rather than as a deployment: `EXPOSE 3000`, no
service, nothing published to a registry, and stdio still the default `CMD`. It builds with
`cargo build --locked` and ends as a non-root `USER`. **Keep both of those** — see the
Dockerfile row in [`../wiki/security/security-boundaries.md`](../wiki/security/security-boundaries.md).
