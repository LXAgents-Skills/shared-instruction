---
name: content-publishing
description: Editing content/ publishes to every consuming repository — the boot invariants, the release obligation, and why .agents/ is not published.
---

# Content Publishing

`content/` is not a source folder. It is the **product**: every file in it is served as
its own tool and read by every repository that connects the connector.

A file added to `content/` is published on the next boot. There is no draft space and no
staging area inside it.

## The boundary

| Change to… | Effect |
|---|---|
| `content/**` | Published. Changes behaviour in every consuming repository. Is a release. |
| `.agents/**` | Local to this repository. Published to nobody. |
| `wiki/**` | This repository's human documentation. Published to nobody. |
| `src/**`, `test/**` | The server. A release only when it changes the served surface. |

Before editing anything under `content/`, ask the routing question from
[`content/rules/directories.md`](../../content/rules/directories.md): *is this true for
more than this repository?* If the answer is no, it belongs in `.agents/` and must not
go into `content/`.

## Boot invariants

`src/instructions/from-content.js` builds the whole tool surface at import and **throws rather
than start** when one of these is violated. They are not style preferences; each one would
break a consuming repository silently:

| Invariant | Why it is fatal |
|---|---|
| The name derived from the file is a valid MCP tool name | A client rejects a malformed name, and the file is unreachable. |
| No two files derive the same name | One would silently shadow the other, and the shadowed file becomes unreachable with nothing to say so. |
| Every file has a frontmatter `description` | A tool with no description cannot be routed on — which is the only reason a description exists. |
| The set is not empty | A server exposing nothing is a misconfiguration, not a valid state. |
| Every `NAME_OVERRIDES` key names a file in the set | A rename would otherwise leave an override quietly matching nothing, and the file would take its derived name. |

The first two are why the derivation is mechanical and exceptions are explicit. A
collision is resolved by adding an entry to `NAME_OVERRIDES`, never by renaming a file to
fit.

`npm test` checks those and pins the properties they do not cover: `name` and `description`
frontmatter on every file, files and tools as a bijection in **both** directions, no tool
declaring an input schema, every file served byte-for-byte as it sits on disk, no tool
but `automation` pointing at another, and `automation` routing every tool once and staying
under its size budget. Run it before committing anything under `content/`.

## Each tool ends in itself

A tool is read on its own, by a session that has not read any other, so a link to another
tool is a link to text the reader does not have. **No file under `content/` links to,
names, or sends the reader to another tool**, with one exception: `automation.md`, the hub,
which exists to name them all. A tool that needs a neighbour's fact states it in a sentence
of its own; it does not copy the neighbour's procedure. The test checks links, other tools'
paths, and other tools' ids and frontmatter names, and has one allowlist entry — Anthropic's
own skills that happen to share a name with two tools.

## The hub is part of the surface

Adding a tool means adding its row to `content/automation.md` in the same commit — one line,
`` `id` — the condition that activates it ``. A test fails if a tool has no row or a row names
a tool that does not exist. The hub is read in **every** session, so its size is a recurring
cost: keep a condition to one line, and keep the file under the budget the test names.

**Writing a description.** A tool description is the only text a client reads before
deciding to call it, so it is routing information, not a summary. Say what the file is
for and when to reach for it. Keep it under about 140 characters — nothing enforces that,
but routing quality is capped by description quality, and a description nobody can scan is
a description nobody routes on.

## A content change is a release

Because consumers read the set live, they pick a change up on their next read with no
upgrade step. That makes the release log the only notice they get, so:

1. Decide the version with the user first —
   [`content/rules/versioning.md`](../../content/rules/versioning.md). Never bump
   unasked.
2. Add `wiki/logs/{Major}/{Minor}/{Patch}/CHANGELOG.md`, with the **Consumers must**
   line filled in: nothing, re-read a file, or drop an override.
3. Add the row to [`.agents/index/logs-index.md`](../../.agents/index/logs-index.md),
   newest first.
4. Update `package.json`.

**Adding a file is a minor bump and one row in the hub.** It arrives as a new tool; no
existing consumer has to act, and no source file changes to publish it.

Renaming or removing a file is a **major** bump. The tool name is derived from the
filename, so a rename removes a tool a consumer's `AGENTS.md` may name, and a consuming
repository's override silently stops matching — its local copy quietly becomes
authoritative. A deletion has the same effect one release later.

## Restart to see a change

The set is read once at boot into a frozen map, so editing `content/` has no effect on a
running process. stdio has no watch mode; restart the client, or the server, to pick a
change up. `npm run inspect` shows the surface a fresh process would build.

## Change the file, not the surface

Every tool serves its file whole, frontmatter included, byte-identical to what is on
disk. There is no payload layer that composes a procedure differently per surface, because
there is only one surface. When changing a procedure, change it in `content/` — never in
`src/` — and let the bijection test confirm the published text still matches.
