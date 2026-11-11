# Connect a Repository

How to put a repository onto the shared instruction set.

## 1. Add the connector

The server speaks **stdio by default**, so this is a local command:

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

To run it from a checkout instead, run `npm install` in the clone (it builds `dist/`), then point `command: node` at
`dist/index.js` with `cwd` set to the clone — the full procedure, including where to put the clone, is in
[Install as a local Skill MCP server](install-as-local-mcp.md).

**There is also a remote form**, for a server running at a fixed address rather than
spawned per client. Start it with `npm run start:http` — it binds `0.0.0.0:3000` unless
`PORT` says otherwise, and on any address but loopback it **will not start without `MCP_AUTH_TOKEN`** — and register it by
URL, sending the same token as a bearer credential:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "type": "http",
      "url": "https://shared-instruction.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

`${MCP_AUTH_TOKEN}` is read from the client's own environment, so the token is not written
into a file that gets committed. Use a client that can send a header — Claude Code
(`claude mcp add --transport http … --header "Authorization: Bearer …"`), a `.mcp.json`
`headers` entry, the Agent SDK, or the Inspector. A client that can only authenticate with
OAuth cannot use a static token. Without the header every request except `GET /healthz`
is a `401`, and the connector reports no tools.

The same tools either way; the transport changes how you reach them, not what they are.
**Prefer stdio for a repository that can spawn a process** — it needs no port to expose, no
token to keep, and no process to keep alive. Choose HTTP when the server's lifecycle should not
be tied to one client. Put TLS in front of it, since a bearer token over plain `http` can be
read on the path, and if you expose it beyond loopback, set `MCP_ALLOWED_HOSTS` — see
[Security model](../security/security-model.md).

**Registering does not reach a running session.** A client loads its connector list at
session start, so a server added mid-session reports healthy and is still absent from the
tool surface until the session restarts. That is the most common cause of "the connector
is not resolving", and it looks like a broken server rather than a stale session.

## 2. Declare the tools

Add a **Shared instruction tools** block to the repository's `AGENTS.md`: a first row for
`lxagents_skills_shared_instruction_automation`, which the agent reads at the start of every session, and a row for each
convention the repository uses. `lxagents_skills_shared_instruction_automation` lists every tool and the condition that
activates it, so the block can stay short. Ask the owner before writing anything — license,
initial version, project intent — and never invent an answer.

## 3. What you end up with

```
AGENTS.md                     entry point + connector bootstrap
                              + the Shared instruction tools block
README.md                     overview only
LICENSE
.agents/
  index/                      root, agents, agent-wiki, project-wiki, memory, logs
  rules/repository.md         this repository's own rules
  wiki/context/repository-map.md
  memory/state/…  memory/tasks/…
wiki/
  information/…  environments/…
  logs/{Major}/{Minor}/{Patch}/CHANGELOG.md
```

What you do **not** end up with: any copy of the served set. A copy would override the
shared original by `name` and then go stale.

## 4. If the repository already has an `.agents/` tree

Do not merge it by hand. Audit it, and only when the owner asks:

1. Compare every local instruction file against the served tool of the same `name`.
2. Classify each as an exact duplicate, a stale copy, a declared override, or local-only.
3. Report each with a verdict and wait.
4. Delete only what the owner approves, removing the index rows in the same commit.

Never delete memory, wiki pages, indexes, or `repository.md`.

## 5. Verify

Ask the agent to confirm:

- `AGENTS.md` tells the agent to read `lxagents_skills_shared_instruction_automation` at the start of every session, and to
  say plainly in its first message if the connector is unavailable.
- `AGENTS.md` declares the **four mandatory tools** in its Shared instruction tools block —
  `lxagents_skills_shared_instruction_plan_creator`, `lxagents_skills_shared_instruction_branching_strategy`, `lxagents_skills_shared_instruction_commit_conventions`, `lxagents_skills_shared_instruction_discovery_protocol` — and
  carries the three permission gates **inline**, not deferred to a tool.
- **Every tool name in that block is one the connector actually publishes.** Tool names
  are derived from filenames, so a block copied from an older set will name tools that no
  longer exist. Enumerating `tools/list` and diffing is the check.
- No `INDEX.md` exists anywhere.
- The override table in `.agents/index/root-index.md` is present — empty is a valid and
  meaningful state.
- Nothing served by the connector exists as a local file.

## When the connector is unavailable

The agent should say so plainly, in its first message, and name which conventions it could
not read. It must not reconstruct the missing rules from memory, and must not clone or
paste the shared set in as a workaround.

## Related pages

- [Install as a local Skill MCP server](install-as-local-mcp.md) — running it from a clone
  under `./mcps/`.
- [Overview](../information/overview.md)
- [Skill MCP surface](../reference/mcp-surface.md)
