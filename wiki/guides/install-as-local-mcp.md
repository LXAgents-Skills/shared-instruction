# Install as a Local Skill MCP Server

How to run the shared instruction set from a clone on your own disk.

**A clone is the normal case from 6.0.6.** The server is a Rust binary now, built from the
clone, and nothing is published to npm or crates.io any more. A host serving it over HTTP is
the other path — see [Connect a repository](connect-a-repository.md).

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

## 2. Build and verify

```bash
cd ./mcps/LXAgents-Skills/shared-instruction
cargo build --release
cargo test
```

Rust 1.88 or newer, from <https://rustup.rs>. The first build downloads the dependencies from
crates.io and takes a minute or two. It produces two binaries in `target/release/`:
`lxagents-shared-instruction`, which a client spawns, and `lxagents-shared-instruction-http`.
`cargo test` reports **87 passing**. If the set cannot be loaded, both binaries exit 1 with a
line naming the file and the invariant it broke.

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
      "command": "./mcps/LXAgents-Skills/shared-instruction/target/release/lxagents-shared-instruction"
    }
  }
}
```

No `args` and no `cwd`: the binary finds `content/` from its own location, so it runs the
same from any working directory. **A config from before 6.0.6 runs `node dist/index.js`, and
that file no longer exists**; replace the entry with the one above. If your client needs an
absolute path, give it one. On Windows the binary is `lxagents-shared-instruction.exe`.

**This page is about the local stdio path, and stdio is the right default here.** A clone
you run per client needs no port, no host, and no process kept alive between sessions.

The server also speaks HTTP, for when you want one instance serving several clients rather
than one per client. **Bound to loopback it is still a local install and needs no token:**

```bash
HOST=127.0.0.1 ./target/release/lxagents-shared-instruction-http    # this machine only, no token; $PORT or 3000
```

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Bound to every interface (the default, `0.0.0.0`) it is a server, and it will not start without
a token; every client then sends it:

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
./target/release/lxagents-shared-instruction-http
```

with `"headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }` added to the entry above. The
same tools either way. Set
`MCP_ALLOWED_HOSTS` to a comma-separated list of hostnames if you expose it beyond loopback — see
[Security model](../security/security-model.md).

## 5. Paste this into your `AGENTS.md`

Drop this block in as-is. It tells an agent how to bring the set up when the connector is
not already resolving.

```markdown
## Shared Instruction Set — Local Install

The conventions this repository follows live in the shared instruction set served by the
**`lxagents-shared-instruction`** Skill MCP server. Resolve it before doing any work.

If the connector is already available in this session, use it and ignore the rest of this
block. If it is not, install it locally:

    mkdir -p ./mcps/LXAgents-Skills
    git clone https://github.com/LXAgents-Skills/shared-instruction ./mcps/LXAgents-Skills/shared-instruction
    cd ./mcps/LXAgents-Skills/shared-instruction && cargo build --release

Then register it as a stdio Skill MCP server named `lxagents-shared-instruction`, with
`command: ./mcps/LXAgents-Skills/shared-instruction/target/release/lxagents-shared-instruction`
and no arguments. A host serving it over HTTP registers
`type: http`, `url: https://<host>/mcp` and an `Authorization: Bearer <token>` header
instead, under the same name; without the header every request is a `401`.

**`mcps/` must be in this repository's `.gitignore`.** The clone is a runtime, not
content. It is never committed.

Once it resolves, read `lxagents_skills_shared_instruction_automation` and route from there. Every file in the set is its own
tool, named after its filename, so the tool list is the index — call the one whose
condition is true. Never copy a shared file into this repository: if you can read it from the
connector, it must not exist here as a file.
```

## Keeping it current

A clone is a snapshot, so it goes stale.

```bash
cd ./mcps/LXAgents-Skills/shared-instruction && git pull && cargo build --release
```

Then **restart the server**. The set is read once at boot into a frozen map, so a
`git pull` does nothing to a process that is already running.

To see what you are running against,
`npx @modelcontextprotocol/inspector target/release/lxagents-shared-instruction` lists the live
surface, `GET /healthz` on the HTTP binary answers with the version, and `Cargo.toml` carries
it.

## Removing it

```bash
rm -rf ./mcps/LXAgents-Skills/shared-instruction
```

Nothing else to undo — that is the point of keeping it out of git.

## Related pages

- [Connect a repository](connect-a-repository.md) — the connector block, and the HTTP path.
- [Local setup](../environments/setup.md) — running the server in detail.
- [Skill MCP surface](../reference/mcp-surface.md) — the tool surface.
