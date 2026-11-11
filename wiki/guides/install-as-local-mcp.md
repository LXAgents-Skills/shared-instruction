# Install as a Local MCP Server

How to run the shared instruction set from a clone on your own disk.

The published npm package is the normal case — see
[Connect a repository](connect-a-repository.md). Use a clone when:

* **You are working on the instruction set itself** and want your edits live.
* **You are offline**, or behind a network that will not reach the registry.
* **Your client cannot run `npx`**, only a local command.

## The one rule that makes this safe

**The clone is a runtime, not a copy of the instruction set.**

That distinction is the whole reason this is allowed. The rule against vendoring the shared
set into a repository still holds, and means it. What you are cloning here is the **server that serves**
the set. Three conditions keep the two apart, and all three are required:

1. **`mcps/` is gitignored.** It never enters your repository's history. A committed
   `./mcps/` *is* a vendored copy, and should be treated as one.
2. **Instructions are still read through the connector.** Never open
   `./mcps/LXAgents-Skills/shared-instruction/content/…` by file path — that is reading a
   snapshot, which is exactly the drift the connector exists to remove.
3. **Nothing is copied out of it** into `.agents/`. The adoption rules are unchanged: if
   you can read it from the connector, it must not exist in your repository as a file.

Get those wrong and you have not installed a server, you have vendored the set with
extra steps.

## The layout

Clones live under `./mcps/`, one directory per owner, one per repository:

```
./mcps/{org or owner name}/{repo name}/
```

For this repository that is exactly:

```
./mcps/LXAgents-Skills/shared-instruction/
```

The shape is fixed. It is predictable for tooling, it namespaces by owner so two
repositories with the same name do not collide, and it keeps every local MCP server in
one place you can delete in one command.

## 1. Clone it

```bash
mkdir -p ./mcps/LXAgents-Skills
git clone https://github.com/LXAgents-Skills/shared-instruction ./mcps/LXAgents-Skills/shared-instruction
```

## 2. Install and verify

```bash
cd ./mcps/LXAgents-Skills/shared-instruction
npm install
npm test
```

Node 20 or newer. There is no build step. `npm test` reports **19 passing** — if the
registry refuses to start, the error names the file and the invariant it broke.

## 3. Ignore it — do this before your next commit

Add to your repository's `.gitignore`:

```gitignore
# Local MCP server clones — runtimes, never vendored content
mcps/
```

This is step 3 of 5 and the one that actually matters. Everything else is convenience;
this is what keeps a runtime from becoming a permanent copy.

## 4. Point your client at it

Register it as a local stdio server. The connector id is `lxagents-shared-instruction`; it
was `lxagents-agents-base` before `2.0.0`, so an existing configuration using the old name
has to be updated.

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "./mcps/LXAgents-Skills/shared-instruction"
    }
  }
}
```

If your client needs an absolute path, give it one — the relative form above is what the
layout is for, but nothing depends on it.

**This page is about the local stdio path, and stdio is the right default here.** A clone
you run per client needs no port, no host, and no process kept alive between sessions.

The server also speaks HTTP, for when you want one instance serving several clients from a
fixed address rather than one per client:

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"   # required: HTTP will not start without it
npm run start:http    # binds 0.0.0.0:3000, or $PORT
```

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

The same tools either way, but only HTTP needs the token; the stdio form above needs none. Set
`MCP_ALLOWED_HOSTS` to a comma-separated list of hostnames if you expose it beyond loopback — see
[Security model](../security/security-model.md).

## 5. Paste this into your `AGENTS.md`

Drop this block in as-is. It tells an agent how to bring the set up when the connector is
not already resolving.

```markdown
## Shared Instruction Set — Local Install

The conventions this repository follows live in the shared instruction set served by the
**`lxagents-shared-instruction`** MCP server. Resolve it before doing any work.

If the connector is already available in this session, use it and ignore the rest of this
block. If it is not, install it locally:

    mkdir -p ./mcps/LXAgents-Skills
    git clone https://github.com/LXAgents-Skills/shared-instruction ./mcps/LXAgents-Skills/shared-instruction
    cd ./mcps/LXAgents-Skills/shared-instruction && npm install

Then register it as a stdio MCP server named `lxagents-shared-instruction`, with
`command: node`, `args: ["src/index.js"]`, and
`cwd: ./mcps/LXAgents-Skills/shared-instruction`. A host serving it over HTTP registers
`type: http`, `url: https://<host>/mcp` and an `Authorization: Bearer <token>` header
instead, under the same name; without the header every request is a `401`.

**`mcps/` must be in this repository's `.gitignore`.** The clone is a runtime, not
content. It is never committed.

Once it resolves, read `automation` and route from there. Every file in the set is its own
tool, named after its filename, so the tool list is the index — call the one whose
condition is true. Never copy a shared file into this repository: if you can read it from the
connector, it must not exist here as a file.
```

## Keeping it current

A clone is a snapshot, so it goes stale — that is the cost you accepted by not using the
published package.

```bash
cd ./mcps/LXAgents-Skills/shared-instruction && git pull && npm install
```

Then **restart the server**. The set is read once at boot into a frozen map, so a
`git pull` does nothing to a process that is already running.

To see what you are running against, `npm run inspect` lists the live surface, and
`package.json` carries the version.

## Removing it

```bash
rm -rf ./mcps/LXAgents-Skills/shared-instruction
```

Nothing else to undo — that is the point of keeping it out of git. Then add the npm
connector per [Connect a repository](connect-a-repository.md).

## Related pages

- [Connect a repository](connect-a-repository.md) — the normal, published path.
- [Local setup](../environments/setup.md) — running the server in detail.
- [MCP surface](../reference/mcp-surface.md) — the tool surface.
