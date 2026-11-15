# Architecture

Rust, edition 2024: one crate with a library and two binaries, on the official MCP Rust SDK
(`rmcp`) and `axum`. `cargo build --release` produces both binaries; `target/` is never
committed. The runtime dependencies are `rmcp`, `tokio`, `tokio-util`, `axum`, `serde_json`,
`sha2` and `subtle` — what each is for is in
`.agents/memory/decisions/rust-rmcp-and-axum.md`.

```
content/                      the instruction set — one markdown file per tool
src/
  main.rs                     binary lxagents-shared-instruction — picks the transport; stdio by default
  bin/
    lxagents-shared-instruction-http.rs   binary — always HTTP
  lib.rs                      the module list, and boot(): load the set or exit
  version.rs                  SERVER_NAME, VERSION, and where content/ is
  instructions.rs             generates one tool per file in content/ — the whole surface
  server.rs                   the rmcp ServerHandler that serves it
  stdio.rs                    entry — one connection over stdin and stdout
  http.rs                     entry — configuration, the port, the runtime, and the drain
  app.rs                      the HTTP application — /mcp, /healthz, the guards. Does not listen.
  auth.rs                     the bearer token: the strength check and the constant-time comparison
  rpc_error.rs                the JSON-RPC error envelope every refusal uses
  log.rs                      timestamped lines on stderr
tests/
  surface.rs                  the surface, through the stdio binary
  http_routes.rs              HTTP routes, the same surface as stdio, and request isolation
  http_hosts.rs               the Host allow-list
  http_limits.rs              the body limit, parse errors, and response headers
  http_auth.rs                the bearer token and the refusal to start without one
  runtime.rs                  the two binaries, the worker threads, and shutdown
  common/mod.rs               starts a binary as a child process and talks to it
```

## The tool surface is generated, not declared

`InstructionSet::load` in `src/instructions.rs` walks `content/` at boot, and for each `.md` file
produces a tool whose name is derived from its filename, whose description is that file's
frontmatter `description`, and whose body is the file's text, byte for byte.

There is no list to keep in step with the set, so **adding a file to `content/` adds its tool**
and nothing else has to change. The only hand-written names are `OVERRIDE_BASES`, for the forge
pages whose filenames would collide.

## Content is read once, at boot

Every file is read when the process starts, and the set is shared behind an `Arc` and never
changed. A tool call is a lookup: no filesystem I/O on the read path, and no work a slow client
can make another client wait behind.

The cost is that content changes need a restart, but not a rebuild — the files are read at run
time, not compiled in. A malformed set is caught at **startup** rather than by the first caller
that needed the broken file: `boot()` stops both binaries on a name that is not a valid MCP
identifier, two files deriving the same name, a file with no frontmatter `description`, a stale
override, or an empty set.

## One handler per connection

`InstructionServer` is the `rmcp::ServerHandler`. stdio has one connection and one handler. The
HTTP service builds a fresh handler for every request by cloning a template, which shares the
loaded set and the prepared tool list rather than copying them. Per-connection state belongs to
rmcp's service for that connection, never to the shared set.

## Two transports

`src/stdio.rs` serves the handler over `rmcp::transport::stdio()`. `src/http.rs` builds the axum
application in `src/app.rs` and binds a port. Both serve the same `InstructionServer` over the
same `InstructionSet`, so the surface they expose is identical by construction — and a test
compares the two tool for tool.

The main binary runs the HTTP path on `MCP_TRANSPORT=http`; the HTTP binary always does. They
are two binaries because the Node server had two entry points, `dist/index.js` and
`dist/http.js`, and each documented command maps onto one of them.

**The HTTP request path, in order:**

1. The `Host` allow-list (`MCP_ALLOWED_HOSTS`, or the loopback names when the server is
   token-less), ahead of everything, `/healthz` included. A refusal is a 403 with a JSON-RPC
   error, `Invalid Host: <name>`; the port is not part of the match.
2. The bearer token, ahead of the body and the routes, with `GET /healthz` the one exact
   exemption. Missing and wrong get different `WWW-Authenticate` challenges and the same 401.
3. The body, read by this crate up to 4 MB and checked to be JSON, so an oversized body and a
   malformed one get the same 400 / `-32700`.
4. rmcp's `StreamableHttpService`, stateless (`legacy_session_mode` off) with JSON responses. Its
   own `Host` check is off, because step 1 already ran with this server's answer.

`GET /healthz` answers `{ status, server, version }`. Any other method on `/mcp` is a 405 with a
JSON-RPC error; any other path is a 404 with `-32601`.

**HTTP off loopback requires a bearer token; stdio and HTTP on loopback do not.** `src/http.rs`
checks the token before it builds a runtime or binds, so a missing one is one line and exit code
`1`. `create_app` refuses to build without a usable token unless told `require_token: false`,
which `src/http.rs` does only for a loopback `HOST`. The stdio path never reads the variable.
The reasoning is in the [security model](../security/security-model.md).

**The HTTP transport is stateless.** No session id is minted and nothing is kept between one
request and the next. The only thing a shutdown needs to know is how many requests are running,
which is one atomic counter.

**Worker threads, not worker processes.** The Node server forked one process per CPU through
`node:cluster`. Here one process binds once, and a Tokio runtime with
`std::thread::available_parallelism()` worker threads — or `MCP_CLUSTER_WORKERS` — answers on all
of them. There is one listener, one startup line, the set is read once rather than once per
worker, and there is no worker process to respawn or orphan. `MCP_CLUSTER_WORKERS=1` is a
single-threaded runtime.

## No path is ever read from a caller

**No tool takes a path**, so a caller has nothing to traverse with. That is the guard, and it is
structural rather than a check: the set is read once at boot from a fixed directory, a tool call
is a lookup by name, and nothing opens a file named by a caller.

## Shutdown

The stdio transport exits `0` when the client closes stdin or on `SIGINT`.

The HTTP transport drains on the first `SIGINT` or `SIGTERM`: it logs
`SIGINT, draining {n} in-flight request(s)`, stops accepting, cancels rmcp's streams, lets the
requests in flight finish, and exits `0`. After a 5 second grace it stops waiting, and a second
signal exits at once rather than queueing behind the first.

## Related pages

- [Overview](overview.md) — what this serves and why.
- [Skill MCP surface](../reference/mcp-surface.md) — the tool surface, and what is not exposed.
- [Environment variables](../environments/env.md) — the six the server reads.
