# shared-instruction

The Skill MCP server that delivers the **LXAgents shared agent instruction set**. A
repository connects it as a connector and reads the conventions it needs — branching,
commits, pull requests, task workflow, the creators, the directory architecture —
instead of cloning or vendoring a copy of them.

- **Server id:** `lxagents-shared-instruction`
- **Package:** `@lxagents-skills/shared-instruction`
- **Transport:** stdio, or stateless HTTP at `POST /mcp` for running it as a service at a
  fixed address. Both serve the same tool surface. **HTTP requires a bearer token**
  (`MCP_AUTH_TOKEN`); stdio, which a client spawns on its own machine, needs none.
- **Surface:** one tool per markdown file in `content/`, and nothing else. Every one is
  read-only and every one takes no arguments. For the current count,
  enumerate the connector's tools.
- **Requirements:** Node >= 20. ESM, no build step.

## Key features

- **One file, one tool.** Every `.md` under `content/` becomes a tool named after its own
  filename, so `git/commit-conventions.md` is `lxagents_skills_shared_instruction_commit_conventions`. **Adding a file to the
  set adds its tool** — there is no registry to edit and no tool module to write, only one
  row in `lxagents_skills_shared_instruction_automation`. The documented exceptions are the GitHub and GitLab pages, named for
  their forge (`lxagents_skills_shared_instruction_github_api`, `lxagents_skills_shared_instruction_gitlab_ci`, …), because four filenames exist on both forges.
- **No tool takes an argument.** A tool names one file, so there is no path to pass, no
  lookup to guess at, and **nothing for a caller to traverse with**. This is the structural
  replacement for a path argument, not a weaker check on one: `test/server.test.js`
  asserts that every tool's schema has no properties and no required fields, so a future
  tool that grows an argument has to be added deliberately.
- **Read once, at boot.** The whole set is read into a frozen map when the process starts.
  An instruction call is a map lookup — no filesystem I/O on the read path — and a malformed set
  fails the process at startup rather than returning a wrong answer to the first caller
  that needed the file.
- **The description is the routing key.** A tool's description is that file's own
  frontmatter `description`, verbatim. A file without one **fails at boot**: it would
  publish as a tool a client cannot route on.
- **One tool is read at session start: `lxagents_skills_shared_instruction_automation`.** It lists every other tool and the
  condition that activates each, and a session calls the others only when their condition is
  true. A session that only branches and commits pays for the hub and two files, not the
  whole set.
- **Per-repository control.** The declaration block is the routing table. A repository that
  stores no model identifier does not carry a row about one, and the narrowing is visible
  in a diff rather than buried in a payload.
- **Each tool ends in itself.** No tool links to, names, or sends the reader to another;
  only `lxagents_skills_shared_instruction_automation` names them all. `test/server.test.js` fails if one does.

## Quick start

```bash
npm install
npm test
```

Serve it to an MCP client over stdio:

```bash
npm start
```

Or as a service over HTTP, which will not start without a token of at least 32 characters:

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
npm run start:http
```

Or inspect the surface by hand:

```bash
npm run inspect
```

Full instructions are in [`wiki/environments/setup.md`](wiki/environments/setup.md).

## Connect it

A local stdio server, named `lxagents-shared-instruction`:

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

For npm consumers the package exposes that binary, so `command: "npx"` with
`args: ["-y", "@lxagents-skills/shared-instruction"]` works without a checkout. See
[`wiki/guides/connect-a-repository.md`](wiki/guides/connect-a-repository.md).

A server running at a fixed address is reached over HTTP instead:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "type": "http",
      "url": "http://shared-instruction.example.com:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

**stdio is still the right default** wherever the client can spawn a process — it has no
port to secure, no token to keep, and nothing to deploy. The HTTP form is for a host that
cannot run Node 20, or for one service several clients share. Every HTTP request except
`GET /healthz` must carry `Authorization: Bearer <token>`, and a bearer token is only as
private as the connection it travels on, so put TLS in front. Set `MCP_ALLOWED_HOSTS` on
anything reachable beyond your own machine; the allow-list is off unless you set it. See
[`wiki/environments/env.md`](wiki/environments/env.md).

**Registering a server does not reach a session that is already running.** A client loads
its connector list at session start, so a server added mid-session reports healthy and is
still absent from the tool surface until the session restarts.

## Docker

```bash
docker build -t lxagents-shared-instruction:6.0.1 .
docker run --rm -i lxagents-shared-instruction:6.0.1                            # stdio
docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-shared-instruction:6.0.1 node src/http.js  # HTTP
```

A pinned, non-root image for hosts that cannot run Node 20. The default entrypoint is
stdio, so `-i` is not optional there — without it the server sees closed stdin and exits.
Overriding the entrypoint to `src/http.js` serves on port 3000 instead, and `-p` is what
makes that reachable; `EXPOSE` documents the port, it does not publish it. The HTTP form
exits unless `MCP_AUTH_TOKEN` is set, and stdio never needs it. Details in
[Docker](wiki/environments/docker.md).

## Documentation

- [Overview](wiki/information/overview.md) — what this serves and why it is a server.
- [Architecture](wiki/information/architecture.md) — how the tool surface is built.
- [Skill MCP surface](wiki/reference/mcp-surface.md) — every tool, and what the server does not expose.
- [Local setup](wiki/environments/setup.md) — running and testing it.
- [Docker](wiki/environments/docker.md) — building and running the image.
- [Security model](wiki/security/security-model.md) — trust boundaries, and what is deliberately not protected.

## Working with agents

The instruction set this server delivers is also the instruction set this repository
follows. Start at [`AGENTS.md`](AGENTS.md); the canonical content lives in
[`content/`](content/).

Because this repository *is* the producer, a change to `content/` changes behavior in
every consuming repository at once. See [`content/rules/versioning.md`](content/rules/versioning.md)
for what that means before you change anything there.

## License

MIT — see [`LICENSE`](LICENSE).
