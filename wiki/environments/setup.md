# Local Setup

A Skill MCP server over stdio, with an HTTP transport available for running it as a service.
There is no CLI. There is a container image — see [Docker](docker.md).

| Mode | What it is | Who uses it |
|---|---|---|
| **Server mode** | A Skill MCP server over stdio, or over stateless HTTP | An MCP client — an editor, an agent, a connector |

## Requirements

Rust 1.88 or newer (edition 2024), from <https://rustup.rs>. The server is one crate: a library
in `src/lib.rs` on the official MCP Rust SDK (`rmcp`) and `axum`, and two binaries. `target/` is
not committed.

```bash
cargo build --release
cargo test
```

The first build downloads the dependencies from crates.io and takes a minute or two; later
builds take seconds. It produces:

| Binary | What it does |
|---|---|
| `target/release/lxagents-shared-instruction` | stdio by default; HTTP when `MCP_TRANSPORT=http` |
| `target/release/lxagents-shared-instruction-http` | HTTP |

The suite is 87 tests: unit tests beside the code, and six integration files in `tests/` that
start the built binaries as child processes. `tests/surface.rs` drives the stdio binary and
covers the frontmatter contract, the file-to-tool bijection, name derivation and overrides,
uniqueness and descriptions, the zero-argument claim, byte-for-byte payload fidelity,
total-served equality, reachability, the `lxagents_skills_shared_instruction_automation` hub,
and that no tool points at another. The `tests/http_*.rs` files drive a real listening process:
the two transports agreeing, `/healthz`, the 405 and the 404, the SSE routes being **gone**,
the 4 MB body limit, concurrent requests, the `Host` allow-list and its startup lines, and the
token. `tests/runtime.rs` covers transport selection, the worker threads, SIGINT and SIGTERM
drains, and a broken set stopping both binaries.

---

## Server mode

### Install

An MCP client spawns the server as a subprocess, so "installing" it means pointing the client
at the binary. From a checkout:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "/path/to/shared-instruction/target/release/lxagents-shared-instruction"
    }
  }
}
```

No `args` and no `cwd`. The binary finds `content/` from its own path: the first ancestor
directory of the executable that holds a `content/` directory, which is the checkout for
`target/release/…`. A binary copied out of its checkout falls back to the checkout it was built
from. Nothing is published to npm or crates.io, so there is no `npx` form.

There is a remote form as well, for a server running at a fixed address.
`lxagents-shared-instruction-http` serves the same tools at `POST /mcp`; see
[Connect a repository](../guides/connect-a-repository.md).

### Run

```bash
target/release/lxagents-shared-instruction                                    # stdio
HOST=127.0.0.1 target/release/lxagents-shared-instruction-http                # HTTP on this machine only, no token
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" target/release/lxagents-shared-instruction-http   # HTTP on 0.0.0.0:3000, or $PORT
```

`cargo run --release --bin lxagents-shared-instruction-http` builds and runs in one step.

**A server needs a token; a local install does not.** stdio never reads `MCP_AUTH_TOKEN`, and
neither does HTTP bound to loopback unless you set it. On any other `HOST`, the default
included, the HTTP binary exits with code `1` and one line on stderr if `MCP_AUTH_TOKEN` is
unset or shorter than 32 characters. The one-liner above makes a throwaway token for a
throwaway run; for anything a client will reach, generate it once, keep it, and give the same
value to the clients. See [Environment variables](env.md).

The two binaries differ only in transport. Same tools, same content, same read-only surface.
`MCP_TRANSPORT=http target/release/lxagents-shared-instruction` is the same HTTP server reached
the other way round, which is how the other servers in the organization select a transport.

The HTTP server runs one Tokio worker thread per CPU behind one listener.
`MCP_CLUSTER_WORKERS=1` makes it single-threaded, which is what you want when debugging. See
[Environment variables](env.md).

### Inspect it

```bash
npx @modelcontextprotocol/inspector target/release/lxagents-shared-instruction
```

This runs the MCP Inspector against the stdio server, listing every tool and letting you call
it. With no prompts or resources, the tool list is the whole surface.

### stdout belongs to the protocol

On the stdio transport, stdout **is** the JSON-RPC channel, and the main binary can be either
transport. So nothing in the crate writes to stdout: every log line goes through `src/log.rs`
to stderr, there is no `println!` in `src/`, and no `tracing` subscriber is installed. A line
added to stdout would corrupt the protocol stream. Tests assert stdout stays empty on HTTP and
carries only JSON-RPC on stdio.

---

## Content changes require a restart

The instruction set is read once at boot, so editing anything under `content/` has no effect
until the process restarts. It does not need a rebuild: the files are read at run time, not
compiled in. This is deliberate — a released set that is never served half-applied is worth
more than live reload — and it is the reason the boot-time checks below exist.

Boot **fails deliberately**, in both binaries and before any transport opens, when a file under
`content/`:

- derives a name that is not a valid MCP tool identifier
- derives the same name as another file in a different folder
- has no frontmatter `description`
- is named by an `OVERRIDE_BASES` entry that matches no file

Each would break routing for every consuming repository, so each is a startup error rather
than a runtime surprise. The fix is usually one line in `OVERRIDE_BASES` in
`src/instructions.rs`.

## Related pages

- [Skill MCP surface](../reference/mcp-surface.md) — the tool surface, and what is not exposed.
- [Environment variables](env.md) — the six the server reads.
- [Architecture](../information/architecture.md) — how the surface is generated.
