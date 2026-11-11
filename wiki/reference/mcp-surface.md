# Skill MCP Surface

Everything `lxagents-shared-instruction` exposes.

**It exposes tools, and nothing else.** One per markdown file in `content/`, all generated;
nothing is hand-written. There are no prompts and no resources. It is reachable over two
transports, and they expose the same tools. See
[What this server does not expose](#what-this-server-does-not-expose).

## Server identity

| Field | Value |
|---|---|
| `name` | `lxagents-shared-instruction` |
| `version` | from `package.json`, read at import by `src/version.js` |
| transport | stdio (`src/index.js`), or stateless HTTP (`src/http.js`, `POST /mcp`) with a required bearer token |

Every entry point calls the same `createServer()`, so the surface is identical by
construction. A test asserts the two agree, tool for tool and byte for byte on a call.

`initialize` also returns `instructions`, which tells a session to read `automation` once at
the start of every session, to call no other tool until its condition is true, and that each
tool is complete on its own.

## The generated tools

One per `.md` file under `content/`. Nothing registers them by hand. For the current
count, enumerate the connector's tools.

### Naming

A tool is named after its own filename:

- the folder is dropped — `git/branching-strategy.md` is `branching_strategy`
- `.md` is dropped
- the name is lowercased and kebab becomes snake
- explicit overrides for the 13 GitHub and GitLab pages, named for their forge
  (`github_api`, `gitlab_ci`, …): four filenames exist on both forges (`api`,
  `authentication`, `issues`, `repositories`), and the rest (`actions`, `ci`, `releases`)
  say nothing about which forge without one

Dropping the folder is what keeps the short names short. The cost is that two folders
holding the same filename would collide — and a collision **throws at boot** rather than
letting the second file silently shadow the first. `skills/github/api.md`
and `skills/gitlab/api.md` is the case that did it, which is why both are overridden.

### Descriptions

A tool's description is that file's own frontmatter `description`, verbatim. That field
already exists to let a caller route without opening the body, which is exactly a tool
description's job.

A file with no frontmatter `description` **fails the process at startup**. It would publish
as a tool no client can route on, and a missing description is invisible until someone
tries to use it.

### Payloads

Each tool returns its file whole — frontmatter included, byte-identical to what is on
disk. The frontmatter is part of the published text, not metadata to strip.

### Arguments

**None. No tool takes an argument.**

This is the load-bearing property of the surface, so it is asserted rather than
described: `test/server.test.js` checks that every tool's `inputSchema` has empty
`properties` and empty `required`.

It is worth being precise about what that replaced. The surface used to be one tool taking
a `path` string, and path traversal is a real concern for that design — which is why a
path check once ran *before* any filesystem call rather than after. With no path argument
there is no traversal to defend against, so the absence of the argument **is** the defence,
and a `..` is not a malformed request but an unnameable one. Nothing reads a path a caller
supplied, and the module that did is gone.

### Failure at boot

`buildContentInstructions()` throws, failing the process, when:

| Condition | Why it is fatal rather than a warning |
|---|---|
| A derived name is not `[a-z][a-z0-9_]{0,63}` | It is not a usable MCP tool name. Add it to `NAME_OVERRIDES`. |
| Two files derive the same name | One would silently shadow the other. |
| A file has no frontmatter `description` | It would publish as an unroutable tool. |
| The set is empty | The server would expose nothing. |
| An override names a file that is not in the set | A rename would leave it matching nothing, and the file would quietly take its derived name. |

A malformed set fails at startup rather than returning a wrong answer to the first caller
that needed the file.

## The hub

`automation` is the one tool a session reads unprompted, and the only one that names the
others. It lists every other tool once, each with the condition that activates it, so a
session loads what its request needs and nothing else. It is the first tool a client lists,
its description opens with the same words as its name — "Read this tool every session" —
and a test fails if it omits a tool, names one that does not exist, or grows past its size
budget, because every session pays for it.

Every other tool ends in itself: none links to, names, or sends the reader to another, and
a test fails if one does. That is what lets a session call one tool and have everything
that tool has.

## The bijection

Every file has exactly one tool, and every tool serves exactly one file. The test suite
asserts **both directions**, because each catches a different mistake:

- **files → tools** catches a file that was added and never surfaced
- **tools → files** catches a tool serving something no longer in the set

Together they make "add a file, get a tool" a property rather than a hope. A second test
asserts that the total characters served across all generated tools equals the total bytes
of the files on disk, so nothing can be served short.

## What this server does not expose

This is the more useful half of the page, because previous versions of this file
documented all of the following as if it were shipped. None of it is.

| Not exposed | Notes |
|---|---|
| **Prompts** | None. |
| **Resources** | There is no `agents://` URI scheme to fetch and no `manifest.json`. |
| **A CLI** | `package.json` declares one bin, `lxagents-shared-instruction`, which is the server. There is no `lxagents-agents`, no `list`/`read`/`setup`/`audit` subcommands, and no `npm run cli`. |
| **A writer** | Every tool is read-only. The tools that would write the set are not registered rather than disabled, so pointing a repository at this server cannot mutate it. A test asserts that no tool accepts a write verb or a credential. |
| **A registry of tools** | `src/constants.js`, `src/server/` and `src/cli.js` were removed. The surface is built by `src/instructions/from-content.js` and the array in `src/server.js`. |
| **Health and readiness endpoints** | `GET /healthz`, and nothing else. **This row previously read the opposite** — "No `/healthz`, no `/readyz`… a probe endpoint on a server that serves only public markdown is a route that exists to be scanned" — and the objection was met with consistency rather than refuted. The four sibling servers already serve `/healthz`, and a deployment that has to treat one of five identically shaped servers differently is one this repository declined to pay for. What answers is `{ status, server, version }` and nothing derived from the set, before any body is read, so the route is not a window onto the content. |
| **Authentication on stdio** | None, and none is needed: a client spawns the process on its own machine, so the only caller is whoever already runs it. The HTTP transport is different — see below and the [security model](../security/security-model.md). |

**What the HTTP transport does expose** is the same tool surface, at `POST /mcp`, plus
`GET /healthz`. **Every route except `GET /healthz` needs `Authorization: Bearer <token>`**,
matched in constant time against `MCP_AUTH_TOKEN`; a missing or wrong token is a `401` with
`WWW-Authenticate: Bearer` and error code `-32001` in the JSON-RPC envelope, and it is given
before the body is read and before any route is revealed, so an unauthenticated caller cannot
tell a `404` from a `405` from a route that exists. The process refuses to start without a
token of at least 32 characters. It is **stateless**: every request carries everything it needs, no session
id is minted, and there is no session store to bound. Any other method on `/mcp` is a 405
that says so, and any other path is a JSON-RPC 404.

The previous transport was a deprecated SSE one that held a session per open stream, and
it is gone. `SSEServerTransport` is deprecated in the SDK in favour of
`StreamableHTTPServerTransport`, and moving off it is breaking for every deployed client —
see the task record under [`.agents/memory/tasks/`](../../.agents/memory/tasks/).

The full tool list is whatever the client enumerates from `tools/list`; it is never written
down here, because a hand-maintained copy of a generated list is a copy that goes stale.

## Cost

The set is loaded once, so a session pays for `automation` and the tools whose conditions
actually fire. Calling every tool reproduces the oversized payload this design replaced, one
call at a time — and there are dozens of them, so that is a real cost rather than a
hypothetical one. `src/server.js`'s `instructions` string says so at `initialize`, and
`automation` says it again as a rule.

## Tests

`test/server.test.js` runs over a real MCP client on an in-memory transport, not a mock. It
covers the frontmatter contract, the bijection both ways, name derivation and overrides,
uniqueness and descriptions, the zero-argument claim, byte-for-byte fidelity, total-served
equality, reachability, the hub (first, total, honest and small), the release-branch wording,
that no tool points at another, and the read-only claim.

`test/http.test.js` is the HTTP counterpart, over a real client against a real listening process and a
real cluster rather than an in-memory transport, because the things that can go wrong on the
HTTP path are about sockets and process boundaries and do not reproduce in memory. It
asserts the two transports expose the same tools and return byte-identical payloads, that
concurrent requests do not cross-talk — in one process or across two — that `/healthz`
answers, that any other method on `/mcp` is a 405 and any other path a 404, that the routes
the SSE transport used are **gone** rather than assumed to be, that the drain reports
in-flight requests and not sessions, that nothing is written to stdout, that a dead worker
is replaced and no worker outlives a killed primary, and that a `Host` header outside
`MCP_ALLOWED_HOSTS` is actually rejected — over `node:http`, because `fetch` cannot set the
header and would test nothing.

There is no `test/tools.test.js` and no `test/logs.test.js`. Those covered the six-tool
convention surface and the changelog delta parser, both of which were removed.
