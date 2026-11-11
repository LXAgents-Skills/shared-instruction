# Architecture

TypeScript (Node ESM, `strict`), compiled by `tsc` from `src/` to `dist/`. `npm install` builds it
through the `prepare` script, so a fresh clone is runnable after one command, and `dist/` is never
committed. Three runtime dependencies: the MCP SDK, `zod`, and `express` for the HTTP transport.
The whole server is eight files.

```
content/                      the instruction set — 32 markdown files
src/
  index.js                    entry — picks the transport; stdio by default
  app.js                      the HTTP transport as an application — /mcp, /healthz. Does not listen.
  auth.js                     the bearer token: the strength check, and the middleware that enforces it
  rpc-error.js                the JSON-RPC error envelope every refusal uses
  http.js                     entry — the cluster, the port, and the drain
  server.js                   builds the McpServer and registers the tool surface
  version.js                  ROOT, CONTENT_DIR, VERSION, SERVER_NAME
  instructions/
    from-content.js           generates one tool per file in content/ — the whole surface
test/
  server.test.js              the surface, over a real client on an in-memory transport
  http.routes.test.js         HTTP routes, the same surface as stdio, and request isolation
  http.hosts.test.js          the Host allow-list
  http.limits.test.js         the body limit, parse errors, and response headers
  http.cluster.test.js        the two entry points and the worker pool
  http.auth.test.js           the bearer token and the refusal to start without one
  helpers/
    http-harness.js           starts a real server as a child process and connects to it
```

## The tool surface is generated, not declared

`buildContentInstructions()` in `src/instructions/from-content.ts` walks `content/` at import, and for
each `.md` file produces a tool whose name is derived from its filename, whose description
is that file's frontmatter `description`, and whose handler returns the file's text.

There is no list to keep in step with the set. `src/server.ts` spreads the result into
`INSTRUCTION_MODULES` and registers each one, so **adding a file to `content/` adds its tool** and
nothing else has to change. That is the reason this design replaced the previous one, which
carried a hand-maintained table in `src/constants.js` alongside a matching prose block in
`src/server/tools.js` — two lists that had to agree, and a boot-time throw when they did not.

## Content is read once, at boot

Every file is read into a `Map` when the process starts, keyed by tool name. An instruction call is
then a map lookup: no filesystem I/O on the read path, and no work a slow client can make
another client wait behind.

The cost is that content changes need a restart. For a set that is versioned and released,
that is the right trade — and a change to `content/` is never served half-applied.

Reading everything up front also means a malformed set is caught at **startup** rather than
by the first caller that happened to need the broken file. Boot throws on a name that is not
a valid MCP identifier, on two files deriving the same name, on a file with no frontmatter
`description`, and on an empty set.

## One server instance per connection

`createServer()` builds a fresh `McpServer` per call. `McpServer` holds per-connection
state — request ids, progress tokens, the transport — and sharing one instance across
concurrent clients is how responses get delivered to the wrong connection. Instances are
cheap; what they share is the already-loaded map.

## Two transports

`src/index.ts` connects `StdioServerTransport`. `src/http.ts` builds the express
application in `src/app.ts` and binds a port. Both call the same `createServer()`, so the
surface they expose is identical by construction rather than by discipline — a change to
the tool set cannot reach one transport and miss the other.

`src/index.ts` reaches `src/http.ts` on `MCP_TRANSPORT=http`, by dynamic import. It is
dynamic because `src/index.ts` is the stdio entry point and stdout there *is* the JSON-RPC
channel: a static import would load express into that process whether or not HTTP was
selected. The two files stay separate because `package.json`'s `start:http` and the
`Dockerfile` both name its compiled form `dist/http.js` and neither may change — so the HTTP path has one more
hop than the other four servers in the organization, and the reason is a file that is not
allowed to move.

**HTTP off loopback requires a bearer token; stdio and HTTP on loopback do not.** `src/auth.ts` reads
`MCP_AUTH_TOKEN` and `src/app.ts` mounts its middleware after the `Host` allow-list and ahead of
the body parser and every route, with `GET /healthz` the one exemption. `createApp` throws
without a usable token unless built with `requireToken: false` (which `src/http.ts` does only
for a loopback `HOST`, adding a `localhost` `Host` allow-list), and `src/http.ts` checks first in the primary so a missing one is a single
line and exit code `1` rather than the same line from each worker and a respawn loop. The stdio
path never imports `src/auth.ts` and never reads the variable. The reasoning is in the
[security model](../security/security-model.md).

**The HTTP transport is stateless.** `POST /mcp` builds a fresh `McpServer` and a fresh
`StreamableHTTPServerTransport` per request, with no session id minted, so the server keeps
nothing between one request and the next. The SSE implementation this replaced held a
`Map` of live sessions keyed by a connection id the client was handed, and the map was the
state. **There is no equivalent store here and nothing replacing it** — the only thing a
shutdown needs to know is what is running right now, so `src/http.ts` keeps a `Set` of
per-request closers, and that is the whole of it.

There is now a worker pool. `src/http.ts` forks `os.availableParallelism()` HTTP workers
unless `MCP_CLUSTER_WORKERS` says otherwise, and every worker binds the same `PORT` through
the cluster's shared handle — the kernel's round-robin scheduler does the distribution, so
no `SO_REUSEPORT` is set by hand and no sticky-session affinity is written. **The primary
binds nothing and writes no `serving over http` line**, so a container's log carries one
startup line per worker, from the processes that actually hold the port. `MCP_CLUSTER_WORKERS=1`
disables the fork entirely, which is what makes the cluster bisectable against a
single-process run.

What that costs is stated rather than assumed: each worker reads `content/` at boot, so the
boot cost is paid once per worker. That is the trade for using the CPUs instead of one, and
it is why the pool is sized by the machine rather than by the request rate.

`stdio` never forks, and cannot: stdout is the JSON-RPC channel there, and a worker's copy
of it would corrupt the stream.

## No path is ever read from a caller

**No tool takes a path**, so a caller has nothing to traverse with. That is the guard, and it
is structural rather than a check: the set is read once at boot from a fixed directory, a
instruction call is a map lookup, and nothing opens a file named by a caller. There used to be a
path-taking read and a check that ran before any filesystem call; both went with the one tool
that reached them.

## Shutdown

The stdio transport has no open connections to drain, so `SIGINT` closes the server and
exits `0` with nothing to order.

The HTTP transport does have requests in flight, and the ordering is not optional: close the
listener first so nothing new arrives, then close the idle keep-alive sockets `close()` is
otherwise waiting on, then cut off whatever is still running after a short grace period.
A removed implementation had the same drain-before-close ordering — see
[`wiki/logs/0/0/0/CHANGELOG.md`](../logs/0/0/0/CHANGELOG.md).

The drain line names what is actually being drained, which is why it changed shape:
`draining {n} session(s)` became `draining {n} in-flight request(s)`. There are no sessions
to count, and a line still counting them would describe a transport that no longer exists.

**Under a cluster the primary relays the signal rather than handling it alone**, because the
workers hold the listener and the requests, and it exits once the last one is gone — so the
port is genuinely closed before the process that started it is. Each worker drains itself and
logs its own line; a second signal during the drain exits at once rather than queueing
behind the first. A worker whose primary is killed outright exits on the IPC disconnect,
which is what stops an orphan holding the port for the next run.

## Related pages

- [Overview](overview.md) — what this serves and why.
- [Skill MCP surface](../reference/mcp-surface.md) — the tool surface, and what is not exposed.
- [Environment variables](../environments/env.md) — the five the HTTP transport reads.
