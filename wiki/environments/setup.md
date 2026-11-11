# Local Setup

A Skill MCP server over stdio, with an HTTP transport available for running it as a service.
There is no CLI. There is a container image — see [Docker](docker.md).

| Mode | What it is | Who uses it |
|---|---|---|
| **Server mode** | A Skill MCP server over stdio, or over stateless HTTP | An MCP client — an editor, an agent, a connector |

## Requirements

Node.js 20 or newer. There is no build step — the server is plain JavaScript (ESM).

```bash
npm install
npm test
```

The suite is six files and a shared harness. `test/server.test.js` drives a real MCP client over an in-memory
transport and covers the frontmatter contract, the file-to-tool bijection in both
directions, name derivation and overrides, uniqueness and descriptions, the zero-argument
claim, byte-for-byte payload fidelity, total-served equality, reachability, the `automation`
hub, that no tool points at another, and the read-only claim. The five `test/http.*.test.js` files drive
a real client against a real listening process and covers the HTTP transport: the two
transports agreeing, `/healthz`, the 405 and the 404, the SSE routes being **gone**, the
4 MB body limit, concurrent requests, shutdown ordering, the `Host` allow-list, the startup
warning when no allow-list is set, and the worker pool — two workers on one port, a dead
worker replaced, no orphan surviving a killed primary, and stdio forking nothing.

---

## Server mode

### Install

An MCP client spawns the server as a subprocess, so "installing" it means pointing the
client at it. From a checkout:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/path/to/shared-instruction"
    }
  }
}
```

From npm, the package exposes that same file as a bin, so no checkout is needed:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "npx",
      "args": ["-y", "@lxagents-skills/shared-instruction"]
    }
  }
}
```

There is a remote form as well, for a server running at a fixed address. `src/http.js`
serves the same tools at `POST /mcp`; see
[Connect a repository](../guides/connect-a-repository.md).

### Run

```bash
npm start             # stdio
npm run start:stdio   # the same thing, named for what it is
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" npm run start:http   # HTTP on 0.0.0.0:3000, or $PORT
```

**HTTP needs a token and stdio does not.** `start:http` exits with code `1` and one line on
stderr if `MCP_AUTH_TOKEN` is unset or shorter than 32 characters. The one-liner above makes a
throwaway token for a throwaway run; for anything a client will reach, generate it once, keep it,
and give the same value to the clients. See [Environment variables](env.md).

The two entry points differ only in transport. Same tools, same content, same
read-only surface. `MCP_TRANSPORT=http node src/index.js` is the same server reached the
other way round, which is how the other servers in the organization select a transport.

`start:http` forks one worker per CPU. `MCP_CLUSTER_WORKERS=1` makes it a single process,
which is what you want when debugging the port or behind a single-connection ingress. See
[Environment variables](env.md).

### Inspect it

```bash
npm run inspect
```

This runs the MCP Inspector against the stdio server, listing every tool and letting you
call it. With no prompts or resources, the tool list is the whole surface.

### stdout belongs to the protocol — on stdio

On the stdio transport, stdout **is** the JSON-RPC channel. Nothing in `src/index.js`
writes to it: there is no logger module, and no `console.log` on that path. A
`console.log` added there would corrupt the protocol stream, which is worth knowing before
adding one.

**`src/http.js` used to be the exception, and no longer is.** It logged its startup lines to
stdout, on the reasoning that the HTTP process speaks JSON-RPC over a socket rather than a
pipe, so stdout was an ordinary logging channel there. That was true and is still true —
and it stopped mattering when `src/index.js` gained `MCP_TRANSPORT=http` and began reaching
`src/http.js` by dynamic import. The same file is now one hop away from a process whose
stdout is a protocol stream, so **both HTTP entry points log to stderr**, and the rule is
one rule rather than an exception with a footnote. A test asserts stdout stays empty.

---

## Content changes require a restart

The instruction set is read once at boot into a frozen map, so editing anything under
`content/` has no effect until the process restarts. This is deliberate — a versioned,
released set that is never served half-applied is worth more than live reload — and it is
the reason the boot-time checks below exist.

Boot **fails deliberately** when a file under `content/`:

- derives a name that is not a valid MCP tool identifier
- derives the same name as another file in a different folder
- has no frontmatter `description`
- is named by a `NAME_OVERRIDES` entry that matches no file

Each would break routing for every consuming repository, so each is a startup error rather
than a runtime surprise. The fix is usually one line in `NAME_OVERRIDES` in
`src/instructions/from-content.js`.

## Related pages

- [Skill MCP surface](../reference/mcp-surface.md) — the tool surface, and what is not exposed.
- [Environment variables](env.md) — the five the HTTP transport reads.
- [Architecture](../information/architecture.md) — how the surface is generated.
