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
| `MCP_TRANSPORT` | `stdio` | Which transport `src/index.ts` speaks: `stdio`, or `http` (`streamable-http` is accepted too). `http` reaches `src/http.ts`, which serves `POST /mcp`. |
| `MCP_CLUSTER_WORKERS` | CPU count | How many HTTP worker processes to fork. **`1` forks nothing.** |

`src/index.ts` reads `MCP_TRANSPORT` and nothing else. The HTTP path — `src/http.ts`, and the
app and `src/auth.ts` it builds — reads the other five.

**When `MCP_AUTH_TOKEN` is required.** Where the server can be reached decides: a server a
client spawns is a pipe on the client's own machine, and HTTP bound to loopback is a socket
only this machine can open, so neither has anyone to authenticate; a server on any other
interface is reachable by anyone who can open a socket, so every request must prove the caller
holds the token. **Never put a reverse proxy in front of a token-less loopback server** — the
proxy would make it reachable, and nothing would stop the caller. Off loopback the token is
required rather than optional. An optional token would mean a deployment that forgot to set it ran
open and said nothing, so instead the process refuses to start — one line on stderr naming the
variable, and exit code `1` — and `createApp` refuses to build without it, so the check cannot
be skipped by calling the app directly.

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"    # 64 hex characters; keep it, clients need it
npm run start:http
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

**Why `MCP_CLUSTER_WORKERS` defaults to a count rather than a number.** One process
handling every request leaves the other CPUs idle, so the default is
`os.availableParallelism()` — the number of CPUs the process was actually given. A container
with two CPUs gets two workers and a laptop does not get eight, and neither has to be told.

```bash
MCP_CLUSTER_WORKERS=4 npm run start:http     # four workers
MCP_CLUSTER_WORKERS=1 npm run start:http     # one process, no fork
```

**`1` means no forking at all**, and that is deliberate rather than a degenerate case: the
same code answers with and without workers, so a difference between the two is a difference
in the fork rather than in the transport. It is also what makes the cluster bisectable
against a single-process deployment. A value below `1` is ignored rather than clamped —
`0` means "I did not mean to set this", and running zero workers would bind no port at all.

**Every worker binds the same `PORT`.** The kernel's shared handle and the round-robin
scheduler do the distribution; no `SO_REUSEPORT` is set by hand and no sticky-session
affinity is written, because the scheduler already knows which connection is next. **The
primary binds nothing and writes no startup line of its own**, so a container's log carries
one `serving over http` line per worker, from the processes that genuinely hold the port.

**Why `MCP_ALLOWED_HOSTS` is off by default, and why that is worth knowing.** It is a
DNS-rebinding guard: it stops a browser on someone's machine resolving an attacker's domain
to a local or internal address and issuing requests the victim's origin policy would block.
The previous implementation of this server had the same control and it **defaulted to off**,
which made its allow-lists inert — see `.agents/memory/tasks/activation-security.md`. That
is a real caveat for any public deployment, so the process prints a line at startup when no
allow-list is configured, rather than leaving the absence to be inferred from silence.

Setting it is one variable:

```bash
MCP_ALLOWED_HOSTS=shared-instruction.example.com,localhost npm run start:http
```

## What configures the server instead

| Thing | How it is set |
|---|---|
| Which file to serve | The path to `dist/index.js` in the client's server config. |
| The instruction set | `content/` beside the package. Resolved from the module's own location, not from the working directory, so it does not matter where the client was started from. |
| The version reported at `initialize` | `package.json`, read at import. |
| Transport | Which entry point is run: `dist/index.js` for stdio, `dist/http.js` for HTTP — or `MCP_TRANSPORT=http` on `dist/index.js`, which reaches the second one for you. |

## What this page deliberately does not document

Session modes, content-root overrides, and the twelve variables an earlier transport
carried. None of them exists, and this is a second revision of a page that documented them
and then had to un-document them. If a future transport reintroduces one, it comes back
here — but it should not arrive silently.

## Why the content root is resolved from the module

`src/version.ts` builds `CONTENT_DIR` from `import.meta.url` rather than from `process.cwd()`.
A client that spawns the server from an arbitrary working directory would otherwise read a
different — or no — instruction set, and the failure would look like an empty connector
rather than a path bug. The HTTP transport is bound by the same rule and resolves its
content root the same way, so serving from a different directory changes nothing. **A forked
worker resolves it once per worker**, which is why the count is CPU count rather than
"one and done": each worker pays the boot cost of reading the set, and that is a deliberate
trade for using the CPUs rather than one.
