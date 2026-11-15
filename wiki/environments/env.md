# Environment Variables

**Six, and exactly one of them is a secret.** Five configure the HTTP transport; the sixth
picks which transport runs. A client that spawns the server over stdio sets none of them,
which is why that path has nothing to configure — and why it needs no token.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | The port the HTTP transport binds. |
| `HOST` | `0.0.0.0` | The interface it binds. **A loopback host (`127.0.0.1`, `localhost`, `::1`) is a local install**: no token needed, and the `Host` header is limited to `localhost`, `127.0.0.1` and `[::1]` unless `MCP_ALLOWED_HOSTS` says otherwise. |
| `MCP_ALLOWED_HOSTS` | unset | Comma-separated hostnames permitted in the `Host` header. **Off when unset.** |
| `MCP_AUTH_TOKEN` | **none — required for HTTP off loopback** | The bearer token every HTTP request except `GET /healthz` must carry. At least 32 characters. **HTTP on any non-loopback `HOST`, the default included, will not start without it.** On loopback it is optional, and enforced when set. stdio never reads it. |
| `MCP_TRANSPORT` | `stdio` | Which transport the main binary, `lxagents-shared-instruction`, speaks: `stdio`, or `http` (`streamable-http` is accepted too, in any case). `http` runs the same HTTP server as `lxagents-shared-instruction-http`. |
| `MCP_CLUSTER_WORKERS` | CPU count | How many Tokio worker threads answer HTTP requests. **`1` is a single-threaded runtime.** The name is kept from the Node server, which forked processes. |

`src/main.rs` reads `MCP_TRANSPORT` and nothing else. The HTTP path reads the other five, once,
in `HttpConfig::from_env` in `src/http.rs`, and passes the values to the app and the token
check; nothing deeper reads the environment.

**When `MCP_AUTH_TOKEN` is required.** Where the server can be reached decides: a server a
client spawns is a pipe on the client's own machine, and HTTP bound to loopback is a socket
only this machine can open, so neither has anyone to authenticate; a server on any other
interface is reachable by anyone who can open a socket, so every request must prove the caller
holds the token. **Never put a reverse proxy in front of a token-less loopback server** — the
proxy would make it reachable, and nothing would stop the caller. Off loopback the token is
required rather than optional. An optional token would mean a deployment that forgot to set it ran
open and said nothing, so instead the process refuses to start — one line on stderr naming the
variable, and exit code `1` — and `create_app` refuses to build without it, so the check cannot
be skipped by calling the app directly.

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"    # 64 hex characters; keep it, clients need it
target/release/lxagents-shared-instruction-http
```

* **Length.** Anything under 32 characters is refused at startup, so a value like `test` is
  found by you and not by a scanner. Surrounding whitespace is dropped, because a token read
  out of a file or an `env_file` often ends in a newline and an HTTP header cannot.
* **Sending it.** `Authorization: Bearer <token>` on every request. A missing header and a wrong
  token are both a `401` with `WWW-Authenticate: Bearer`; the second also says
  `error="invalid_token"`. There is no query-string form, because a URL is logged.
* **One token, shared.** Every client holds the same value, so there is no per-client identity
  and no revoking one client alone. Rotate it by changing the variable and restarting; the
  server is stateless, so a restart drops nothing.
* **Never logged.** The startup line says a token is required and never what it is, and a
  rejected token is not echoed either. Keep it out of the image, the repository and the
  command line: pass it from the environment, an `env_file`, or the host's secret store.
* **`GET /healthz` is the one open route**, so an orchestrator's probe needs no token. It returns
  `{ status, server, version }` and nothing else.
* **Put TLS in front.** A bearer token sent over plain `http` can be read by anyone on the
  path. This server does not terminate TLS; whatever fronts it must.

**Why `MCP_CLUSTER_WORKERS` defaults to a count rather than a number.** One thread handling
every request leaves the other CPUs idle, so the default is
`std::thread::available_parallelism()` — the number of CPUs the process was actually given. A
container with two CPUs gets two threads and a laptop does not get eight, and neither has to be
told.

```bash
MCP_CLUSTER_WORKERS=4 target/release/lxagents-shared-instruction-http     # four worker threads
MCP_CLUSTER_WORKERS=1 target/release/lxagents-shared-instruction-http     # single-threaded
```

**`1` is a single-threaded runtime**, and the startup line says which setting produced the count.
A value below `1`, or one that is not a number, is ignored rather than clamped — `0` means "I
did not mean to set this", not "run nothing".

**There is one listener whatever the count.** The Node server forked one process per worker and
each bound the port through the cluster's shared handle, so its log carried one startup line per
worker. Here one process binds once and the runtime spreads the connections over its threads, so
the log carries one `serving Skill MCP over http` line, and there is no worker process to
respawn or to orphan.

**Why `MCP_ALLOWED_HOSTS` is off by default, and why that is worth knowing.** It is a
DNS-rebinding guard: it stops a browser on someone's machine resolving an attacker's domain
to a local or internal address and issuing requests the victim's origin policy would block.
The previous implementation of this server had the same control and it **defaulted to off**,
which made its allow-lists inert — see `.agents/memory/tasks/activation-security.md`. That
is a real caveat for any public deployment, so the process prints a line at startup when no
allow-list is configured, rather than leaving the absence to be inferred from silence.

Setting it is one variable:

```bash
MCP_ALLOWED_HOSTS=shared-instruction.example.com,localhost target/release/lxagents-shared-instruction-http
```

## What configures the server instead

| Thing | How it is set |
|---|---|
| Which binary to run | The path in the client's server config: `target/release/lxagents-shared-instruction`. |
| The instruction set | `content/`, found from the binary's own path: the first ancestor directory of the executable that holds one, else the checkout it was built from. Not from the working directory, so it does not matter where the client was started from. |
| The version reported at `initialize` | `Cargo.toml`, compiled in. |
| Transport | Which binary is run: `lxagents-shared-instruction` for stdio, `lxagents-shared-instruction-http` for HTTP — or `MCP_TRANSPORT=http` on the first. |

## What this page deliberately does not document

Session modes, content-root overrides, and the twelve variables an earlier transport carried.
None of them exists. If a future transport reintroduces one, it comes back here — but it should
not arrive silently.

## Why the content root is resolved from the binary

`src/version.rs` finds `content/` from `std::env::current_exe()` rather than from the working
directory. A client that spawns the server from an arbitrary working directory would otherwise
read a different — or no — instruction set, and the failure would look like an empty connector
rather than a path bug. No variable chooses it, so a caller cannot point the server at another
directory. The set is read once per process, at boot, by whichever binary runs.
