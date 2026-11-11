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

TypeScript under `strict`, Node ESM (`NodeNext`), Node >= 20. `tsc` is the one build step: it
compiles `src/` to `dist/`, and nothing else transforms the code — do not add a bundler, a second
compiler, or a second `tsconfig` that emits, without agreement. `tsconfig.test.json` exists to
type-check `test/` with the same options, and emits nothing.

**`dist/` is built, never committed.** `prepare` runs `tsc`, so `npm install` in a fresh clone is
what produces it; that is how the owner installs. Every runnable path — `main`, `bin`, the start
scripts, the `Dockerfile`, a client's server config — names `dist/`, and every source path names
`src/`.

| Task | Command |
|---|---|
| Install (and build) | `npm install` |
| Build | `npm run build` |
| Type-check sources and tests | `npm run typecheck` |
| Test (builds and type-checks first) | `npm test` |
| Run (stdio) | `npm start` |
| Run (HTTP) | `npm run start:http` |
| Inspect the MCP surface | `npm run inspect` |
| Build the image | `docker build -t lxagents-shared-instruction:<version> .` |
| Run the image (stdio) | `docker run --rm -i lxagents-shared-instruction:<version>` |
| Run the image (HTTP) | `docker run --rm -p 3000:3000 lxagents-shared-instruction:<version> node dist/http.js` |

There is no `npm run cli`. There is still no `compose.yaml`, and the reason is no longer
that there is no transport to compose — a compose file encodes a deployment, and this
repository has none. See [`../wiki/environments/docker.md`](../wiki/environments/docker.md).

**`docker run` needs `-i`.** Without it Docker does not attach stdin, the server sees
closed input, and it exits immediately. It looks like a broken image and is not.

**`npm install` before `npm test`, once per checkout.** A fresh clone has no
`node_modules`, and the suite does not say so: the test file fails with
`ERR_MODULE_NOT_FOUND`, which reads as broken code rather than an uninstalled tree.
That matters here because [`content-publishing.md`](content-publishing.md) sends you to
`npm test` before any commit under `content/` — so the first test result an agent sees in
a new session is the one most likely to be a lie. Install first, then trust the number.

Full orientation: [`../wiki/context/repository-map.md`](../wiki/context/repository-map.md).

## Code conventions the codebase already follows

* **ESM only.** `import`/`export`, `.js` extensions in relative specifiers (`NodeNext` resolves
  `./server.js` to `src/server.ts` when compiling, and the emitted file keeps the `.js`), no `require`.
* **Nothing writes to stdout.** On the stdio transport stdout *is* the JSON-RPC channel.
  There is no logger module and no `console.log` anywhere in `src/`. `src/http.ts` used to
  be the deliberate exception — the protocol is on a socket there, so stdout was an
  ordinary log channel — and it no longer is, because `src/index.ts` now reaches it by
  dynamic import and the same process can be one transport or the other. It logs to stderr.
  A log line drifting onto stdout is a bug that corrupts the protocol stream in the one
  configuration where stdout is the stream, and that is why it is one rule and not a
  per-file exception.
* **The set is read once at boot and frozen.** Never mutate an entry of the map
  `src/instructions/from-content.ts` builds, and never add a per-request cache keyed on shared
  state — that is what makes concurrent clients safe.
* **Read set text from `content/`; never hard-code it.** A file's own frontmatter supplies
  its tool description, which is why the description can never disagree with the file. A
  hard-coded copy in `src/` is a new mirror to maintain; see
  [`set-mirrors.md`](set-mirrors.md).
* **One `McpServer` per connection.** `createServer()` builds a fresh instance; never hoist
  one to module scope.
* **Fail at boot, not at first call.** Content problems — a name that is not a valid MCP
  identifier, two files deriving the same name, a missing frontmatter `description` — are
  startup errors by design. Keep them that way.
* **Comments explain why, not what.**

## Testing

Every behavioural change ships with a test in `test/`, written in TypeScript and run by
`node:test` through `tsx`, with `node:assert/strict`. The suite must pass, and type-check, before
any commit. Tests import the sources from `src/`; tests that start a server process start the
compiled `dist/` entry points, because that is what a client runs.

`test/server.test.ts` is the surface suite. The `test/http.*.test.ts` files, one per subject
with a shared harness in `test/helpers/http-harness.ts`, cover the HTTP transport against a real listening process, because the things that go
wrong there are about sockets and sessions and do not reproduce on an in-memory transport.
Prefer a test that pins an invariant over one that pins a string: the useful ones here
assert that files and tools are a bijection in both directions, that no tool takes an
argument, that the total characters served equals the total bytes on disk, and that the two
transports agree tool for tool.

## What must not be introduced

* Compiled output committed to the repository, or a build step beyond `tsc`.
* `any`, or an implicit one. `strict` is on for a reason; a type that cannot be written is a
  design question, not something to silence.
* A dependency added to serve one call site. The runtime dependencies are the MCP SDK,
  zod, and `express` — the last added for the HTTP transport and reasoned in
  `.agents/memory/decisions/express-for-http-transport.md`. A fourth needs its own record
  there before it lands, not after.
* An argument on a tool. Every tool names one file, and the absence of a path is what makes
  traversal impossible — a tool that needs a path is a tool that needs the argument back,
  and that is a design decision, not a convenience.
* Filesystem or network I/O on the read path. Reads are map lookups, and keeping them that
  way is why a slow client cannot block others.
* A new listener, route, or environment variable without a say-so. The server has two
  transports and five variables, and each of those was a deliberate decision someone
  approved. `wiki/environments/env.md` says what the current five do; a sixth is a change to
  a public surface, not an implementation detail.
* A third documentation tree. `wiki/` and `.agents/wiki/` are the only two.
* Anything under `content/` that is not part of the published set.

## Deployment

Published to npm as `@lxagents-skills/shared-instruction`, and consumed mostly as a stdio
subprocess. The package exposes one bin, `lxagents-shared-instruction`, which is the
server.

`src/http.ts` can also serve the same tools at `POST /mcp` for a client that reaches a
fixed address instead of spawning a process. **It is a capability, not a deployment** —
this repository routes nothing, names no host, and decides no ingress. The distinction
matters because a listener with no front door is a security claim, and
[`../wiki/security/security-model.md`](../wiki/security/security-model.md) is where that
is argued.

A `Dockerfile` exists for hosts that cannot run Node 20, and it is a way to pin the
toolchain rather than a deployment: `EXPOSE 3000`, no service, nothing published to a
registry, and the stdio entrypoint still the default. It ends as `USER node` and installs
with `npm ci --ignore-scripts`. **Keep both of those** — see the Dockerfile row in
[`../wiki/security/security-boundaries.md`](../wiki/security/security-boundaries.md).
