---
name: agent-wiki-context-repository-map
description: Orientation before touching this repository — what lives where, the commands, the entry points, and the gotchas that actually bite.
---

# Repository Map

Read this before changing anything here. Underlying facts live in `wiki/`; this page is
the agent-facing orientation and links out rather than restating.

## What this repository is

`LXAgents-Skills/shared-instruction` — an MCP server that serves the LXAgents shared agent
instruction set as `lxagents-shared-instruction`. Strict TypeScript, Node ESM, compiled to
`dist/` by `npm run build` (and by `npm install`, through `prepare`).

It is both the **producer** of the shared set and a **consumer** of it. See
[`../../rules/repository.md`](../../rules/repository.md).

## What lives where

| Path | Contents | Touch it when |
|---|---|---|
| `content/` | The published instruction set — every markdown file is served as its own tool, and `automation.md` routes them. | You are changing a convention every repository follows. **This is a release.** |
| `.agents/` | This repository's own rules, indexes, agent wiki, memory. | You are changing something true only here. |
| `wiki/` | Human documentation, plus `wiki/logs/` release history. | A person needs to read it. |
| `src/instructions/` | `from-content.js` builds the whole surface, one tool per file; there is no hand-written tool. | Adding or changing a tool. |
| `src/server.ts` | Builds one `McpServer` and registers every tool; carries the `instructions` text. | Changing the MCP surface. |
| `src/version.ts` | `ROOT`, `CONTENT_DIR`, `VERSION`, `SERVER_NAME`. | Renaming the server or moving the set. |
| `src/app.ts` | The HTTP transport as an application — `POST /mcp`, `GET /healthz`, the 405, the 404, the body limit, the `Host` allow-list, and the token check. Builds and returns; does not listen. | The HTTP surface. |
| `src/auth.ts` | The bearer token: `tokenProblem` (is it usable), `configuredToken` (read at call time, trimmed), and `requireBearerToken` (the constant-time middleware). Reached only by the HTTP path. | Anything about who may call the HTTP transport. |
| `src/rpc-error.ts` | `rpcError`, the one JSON-RPC error envelope — used by the routes and error handler in `app.js` and by the token check in `auth.js`. | Changing the shape of any refusal. |
| `src/http.ts` | The HTTP entry point — the cluster primary and workers, the port, the interface, the startup lines, the in-flight set, and the drain. | Anything about a listening server, a worker count, the port, or shutdown. |
| `Dockerfile` | A pinned, non-root image for hosts that cannot run Node 20. Serves both transports; `EXPOSE 3000`, stdio entrypoint. | The toolchain the image pins, or the install command it runs. |
| `test/` | `server.test.js` (in-memory), and `http.{routes,hosts,limits,cluster,auth}.test.js` (against a real listener and a real cluster, with a token) sharing `helpers/http-harness.js`. `npm test` runs `test/*.test.js`, so the harness is not run as a suite. | Always. Every behavioural change ships with one. |

There is no `src/server/`, no `src/cli/`, no `src/transport/`, and no `src/content/`
directory. If a file you are about to edit is under one of those paths, it does not exist
here.

## Entry points

There are **two**, and they differ only in transport:

* `src/index.ts` — what an MCP client spawns. Connects a stdio transport by default, and
  hands over to `src/http.ts` when `MCP_TRANSPORT=http` is set. Handles `SIGINT`, and
  writes nothing to stdout.
* `src/http.ts` — `npm run start:http`, and the command the `Dockerfile` documents, as
  `dist/http.js`. A
  `node:cluster` primary forks `os.availableParallelism()` workers (`MCP_CLUSTER_WORKERS`
  overrides, `1` disables), each binding the same `HOST`/`PORT` and serving `POST /mcp` and
  `GET /healthz` from the app in `src/app.ts`. **Off loopback it refuses to start without
  `MCP_AUTH_TOKEN`** — checked in the primary, before any fork; on a loopback `HOST` with no
  token it serves open behind a `localhost` `Host` allow-list. **The primary binds nothing
  and logs no startup line**, so the log carries one `serving over http` line per worker. It logs to
  **stderr**, because it is one dynamic import away from a process whose stdout is the
  JSON-RPC channel.

**`src/http.ts` is the HTTP entry point here and `src/index.ts` is it in the other four
servers in the organization.** That is not a preference: `package.json`'s `start:http` and
the `Dockerfile` comment both name `dist/http.js`, and neither may change. The transport
selection therefore lives in `src/index.ts` and reaches `src/http.ts` by **dynamic** import,
so express is not loaded into a stdio process whose stdout is the protocol.

Behind both:

* `src/app.ts` — the whole HTTP surface as a factory. It does not listen, which is why
  `src/http.ts` can be tested and reasoned about without a port.
* `src/instructions/from-content.ts` — walks `content/` at import, derives a tool name and
  description per file, and reads each file once into a frozen `Map`. This is the boot-time
  validation gate, and the only module that touches every file in the set.
* `src/server.ts` — `INSTRUCTION_MODULES`, the array every registered tool comes from. Add a
  module here and its tools appear; nothing else registers anything. Every entry point
  calls `createServer()`, so a change to the surface cannot reach one and miss the other.

## Commands

```bash
npm install
npm test                 # node:test — test/*.test.js
npm start                # stdio
MCP_AUTH_TOKEN=<32+ chars> npm run start:http   # HTTP on 0.0.0.0:3000, or $PORT/$HOST; one worker per CPU; no token, no start
HOST=127.0.0.1 npm run start:http                # HTTP on loopback; no token needed
npm run inspect          # MCP Inspector against the stdio server
```

`npm start` and `npm run start:stdio` are the same thing, and `MCP_TRANSPORT=http npm start`
is `npm run start:http` by another route. There is no watch mode and no
CLI. `docker build -t lxagents-shared-instruction:$(node -p "require('./package.json').version") .`
builds the image, which runs the stdio entrypoint with a pinned toolchain; override the
entrypoint to `dist/http.js` for the HTTP form.

## Gotchas that actually bite

* **`content/` is published.** Adding a file there ships it to every consuming
  repository on the next boot as a new tool. See
  [`../../rules/content-publishing.md`](../../rules/content-publishing.md).
* **Content changes need a restart.** The map is frozen at boot; editing markdown does
  nothing to a running process.
* **Two files outside `content/` copy its text.** The root `AGENTS.md` and the
  `instructions` string in `src/server.ts` both reproduce set text and go stale silently. Grep for a sentence you changed before
  committing — see [`../../rules/set-mirrors.md`](../../rules/set-mirrors.md).
* **HTTP tests need a token, and so does any server you start by hand.** The harness in
  `test/helpers/http-harness.ts` hands every child `MCP_AUTH_TOKEN` and the SDK client the matching
  header; a test that spawns the server any other way, or fetches `/mcp` raw, must do the same
  or it will read a `401` as a failure of the thing it is testing. Blank the variable
  (`MCP_AUTH_TOKEN: ""`) to test the refusal to start.
* **Nothing writes to stdout.** stdout is the JSON-RPC channel on stdio, and `src/index.ts`
  reaches `src/http.ts` by dynamic import, so the HTTP process is one hop away from the
  same constraint. There is no logger module; `src/http.ts` logs to stderr, and so should
  anything else that needs to say something.
* **`fetch` cannot set `Host`,** so a Host allow-list cannot be tested through it — it
  drops the header and every request arrives as `127.0.0.1`, which passes or fails for the
  wrong reason. `requestWithHost` in the harness uses `node:http` for those assertions. If you add one,
  do not "simplify" it back to `fetch`.
* **Never share an `McpServer` between connections.** It holds per-connection state;
  reusing one delivers responses to the wrong connection. `createServer()` builds a fresh
  one every time — which is now also per worker, since each forked process has its own.
* **A worker must die with its primary.** `process.on("disconnect", …)` in `src/http.ts` is
  not defensive tidiness: without it a worker whose primary was `SIGKILL`ed keeps the port,
  keeps answering, and makes the *next* test run fail on `EADDRINUSE` against a process
  nobody remembers starting.
* **No tool declares an input schema, and none should.** An object schema that rejects
  `undefined` breaks clients that omit `arguments` — which is why these tools declare
  none. Do not "tidy" a schema in; if a tool needs an argument, that is a design decision
  to make deliberately, not a cleanup.
* **A file rename is a breaking change, not a rename.** The tool name is derived from the
  filename, so renaming removes a tool a consumer's `AGENTS.md` may name.
* **Two files with the same basename collide.** The folder is stripped from the name, so
  the boot throws rather than letting one shadow the other. Resolve it with an entry in
  `NAME_OVERRIDES`, not by renaming a file.

## Generated and vendored paths

`node_modules/` only. Nothing is generated into the tree, and there is no `dist/` —
if you find yourself adding one, stop and re-read
[`../../rules/repository.md`](../../rules/repository.md).

A `.dockerignore` sits at the root and governs what the image copies in — it keeps
`node_modules`, `test`, `wiki`, `.agents` and the root markdown out, which is why the image
cannot run its own suite. There is no `compose.yaml`, still, and the reason has changed
rather than gone away: the HTTP transport exists now, so it can no longer be "there is no
transport to compose" — it is that a compose file encodes a deployment and this repository
has none. See [`../../../wiki/environments/docker.md`](../../../wiki/environments/docker.md).

## Where the shared set resolves from

`content/`, in the working tree — not the deployed connector. You are editing the set,
so the working tree is the authority.

## Further reading

* [`../../../wiki/information/architecture.md`](../../../wiki/information/architecture.md) — how the server is built and why.
* [`../../../wiki/reference/mcp-surface.md`](../../../wiki/reference/mcp-surface.md) — the tool surface, and what it deliberately does not expose.
* [`../../../wiki/environments/env.md`](../../../wiki/environments/env.md) — configuration.
* [`../security/security-boundaries.md`](../security/security-boundaries.md) — the security SOP, and the rule against carrying a security context between repositories.
