---
name: memory-state-repository-state
description: Current known state of LXAgents-Skills/shared-instruction — what exists, what is deployed, and what is not built yet.
---

# Repository State

## 2026-10-09

**The tool set was replaced.** `content/` now holds the owner's re-created set — 47 files —
plus `automation.md`. The 34 files it held before are gone, and so is `mcp_list`. The record of
how is `.agents/memory/tasks/replace-tool-contents.md`.

**Surface.** One tool per file, all generated; nothing is hand-written. The name is the
filename with the folder stripped and kebab turned to snake, with explicit overrides for the 13
GitHub and GitLab pages (`github_api` … `gitlab_repositories`), because four filenames exist
on both forges. `AGENTS.md` is no longer served, so its `agents_entry_point` override is gone.
No tool takes an argument.

**Session start.** `automation` is read once per session. It lists every other tool and the
condition that activates it; the others are called only when their condition is true. The
`initialize` instructions, `AGENTS.md` and a test all pin that wording. It is text, not
mechanism: a read-only server cannot make a client call a tool.

**Each tool ends in itself.** No tool but `automation` links to, names, or sends the reader to
another, and `test/server.test.js` fails if one does. A tool that needs a neighbour's fact
states it in a sentence.

**Other conventions that changed with the set.** Frontmatter is `name` and `description` only —
no `version`, no `author`. The release task's branch is `release/{version}` with no `v`; the
git tag carries the `v`.

**Version.** `6.0.3` — a patch: HTTP on a loopback `HOST` starts without `MCP_AUTH_TOKEN`, behind a `localhost` `Host` allow-list; any other bind still requires it. `6.0.2` before it renamed every tool to `lxagents_skills_shared_instruction_{base}`. `6.0.1` before it split the HTTP suite and added one JSON-RPC error helper. `6.0.0` before it was a major, because the npm package moved to `@lxagents-skills/shared-instruction`
and `src/tools/` became `src/instructions/`. The log is `wiki/logs/6/0/0/CHANGELOG.md`. `5.0.0`
before it was a major because the HTTP transport requires a bearer token. No git tag has been created.

**A known tension, left for the owner.** The new contents were written for a plain-files
workspace and some say no MCP server serves them. The list is in the task record.

## 2026-09-30

*Superseded where it differs from the 2026-10-09 section above: the tool surface, `mcp_list`
and `agents_entry_point`, the file count, the four-field frontmatter, and "call nothing at
session start".*

**What this is.** A read-only MCP server that serves the LXAgents shared agent instruction
set. Plain JavaScript, Node ESM, no build step. Published as
`@lxagents-skills/shared-instruction`; the server name is `lxagents-shared-instruction`, renamed
from `lxagents-agents-base` in `2.0.0`. Every consuming repository named the old one in
its client configuration, so each has to update it.

**Not dual-purpose.** There is no CLI. `package.json` declares one bin,
`lxagents-shared-instruction`, which is the server. The `lxagents-agents` CLI, the `mcp_repos`
and `mcp_creator` tools, MCP prompts, `agents://` resources, and a `manifest.json` were all
removed in #63. `content/index/root-index.md` and several `content/` files still used
`agents://` link notation; that survives as prose addressing, not as a fetchable endpoint.

**Three permission gates, not two.** Approve the plan, ask before opening a pull request,
ask before merging. `shared-instructions.md` §H owns the sentence; the root `AGENTS.md`,
`content/prompts/agents-setup.md`, and the `instructions` string in `src/server.js`
restate it — three mirrors, listed in `.agents/rules/set-mirrors.md`.

**This repository has its own security context.** `wiki/security/security-model.md` (facts)
and `.agents/wiki/security/security-boundaries.md` (the SOP), loaded by a **local** trigger
row. Its first rule is that a security context never crosses repositories.

**Structure.** `content/` holds 33 published instruction files. `.agents/rules/` holds
three local rules: `repository.md`, `content-publishing.md`, and `set-mirrors.md`. `wiki/`
holds human documentation. `src/` is eight files and `test/` is two.

**Surface — one tool per file.** 34 tools: 33 generated from `content/`, one per file,
plus `mcp_list`. The name is derived from the path (folder stripped, `.md` dropped, kebab →
snake), with one override: `AGENTS.md` → `agents_entry_point`. The description is the
file's own frontmatter `description`, verbatim. **No tool takes an argument.**

That is a change from `1.0.0`, where six hand-named convention tools replaced the
single 31,000-character `agents_auto_activation` call. The four mandatory ones are still
`plan_creator`, `branching_strategy`, `commit_conventions`, and `discovery_protocol`, but
they are no longer a fixed set: there are 33 files, and a repository declares in its own
`AGENTS.md` which of them it uses.

**Tool counts in the HTTP tests are derived, not hardcoded.** They come from
`INSTRUCTION_MODULES.length` — the same array `createServer()` registers from — so adding a file
to `content/` no longer means editing four numbers. That change also removed the friction
this note used to record: previously the counts were pinned, and a new file failed the
suite in four places at once.

`mcp_list` is the one hand-written tool, and the only one that reaches `readSetFile` in
`src/content.js` — with a constant path. Because no tool takes a `path`, there is nothing
for a caller to traverse with; the zero-argument design is the replacement for the old
traversal check, not a weaker version of it.

**Transports.** Two, both calling the same `createServer()`, so the surface is identical by
construction: `src/index.js` (stdio by default, and `MCP_TRANSPORT=http` to reach the
other) and `src/http.js`, which binds the port and serves the express app in `src/app.js` at
`POST /mcp` and `GET /healthz`. **The HTTP transport is stateless** — a fresh `McpServer`
and a fresh `StreamableHTTPServerTransport` per request, no session id minted, and no
session store. It replaced an SSE transport at `GET /sse` and `POST /message` whose
`SSEServerTransport` was **deprecated in the SDK**; that removal is **breaking for every
deployed client** and was a deliberate, owner-reviewed decision — see
`.agents/memory/tasks/sse-to-mcp-transport.md`. The application is in `src/app.js` and does
not listen, which is what lets `src/http.js` own the port, the startup lines and the drain
without the two being tangled. `src/index.js` reaches it by **dynamic import**, so express
never loads into a stdio process whose stdout is the JSON-RPC channel. Six environment
variables are read, one of them a secret: `PORT`, `HOST`, `MCP_ALLOWED_HOSTS`,
`MCP_AUTH_TOKEN`, `MCP_TRANSPORT` and `MCP_CLUSTER_WORKERS`. **The HTTP transport requires
`MCP_AUTH_TOKEN`** — a bearer token of at least 32 characters on every route except
`GET /healthz` — and will not start without it; stdio never reads it. The authentication
change is recorded in `.agents/memory/tasks/http-token-auth.md`. **The allow-list is off unless
set**; the same control in the removed transport defaulted to off, which made it inert. **The HTTP entry
point is a `node:cluster` primary**: it forks `os.availableParallelism()` workers by
default, each binding the same `PORT` through the cluster's shared handle, and the primary
itself binds nothing and writes no `serving over http` line — so a container's log carries
one startup line per worker, from the processes that genuinely hold the port.
`MCP_CLUSTER_WORKERS=1` forks nothing, and stdio never forks because a worker's copy of
stdout would corrupt the JSON-RPC stream.

**The held item on the transport change is released.** `content/rules/mcp-connector.md`
documented the connector as `"type": "sse"` at `/sse` while the server answered
`POST /mcp`; it now documents `"type": "http"` at `/mcp`, and the set and the repository
agree again. The owner approved `3.0.2` and the addition of
`content/planning/task-workflow.md`; both shipped in `3.0.2` with the log at
`wiki/logs/3/0/2/CHANGELOG.md`. **The numbering is the owner's call and departs from
`content/rules/versioning.md`**, which classes a breaking convention change as major and
an added file as minor. The changelog says so in its own header, because a patch number
otherwise promises there is nothing to do and there is.

**Deployed, and reachable.** A Render service serves the HTTP transport at
`https://lxagents-mcp-shared-instruction.onrender.com` — `POST /mcp` for the protocol and
`GET /healthz` for liveness, which answered `200` when checked on 2026-09-30. **A version that
requires `MCP_AUTH_TOKEN` will not start on that service until the variable is set on it**, and
the service tracks `master`, so merging the change deploys it; every client of the endpoint then
needs the `Authorization` header. Set the variable and update the clients first. **This file
previously said "Not deployed anywhere", and that was wrong rather than stale**: the
listener is a capability *and* a running service, and treating them as the same thing is
what hid it. Consuming repositories reach this package through `npx`, a local clone,
`docker run -i`, or that endpoint.

**A deployment is promoted by merging to `master`.** The service tracks the default branch
and rebuilt on its own: `master` reached `3.2.0` and the live endpoint followed within
about two minutes of polling, with no manual step and no in-repo deploy configuration —
there is no `render.yaml` and no CI. **Nothing in this repository records that, and
recording it is the only reason it is written down here.**

**`GET /healthz` cannot tell you which version is serving.** It reports liveness and the
version string, so an instance answers `200` while still serving an older set. The check
that distinguishes them is a `tools/list` against `POST /mcp`, or the `version` field in
`initialize`. Polling `/healthz`'s version is enough to *notice* a rollout; confirm the
content with a tool call before reporting a deploy as done.

**A `Dockerfile` exists, and is not a deployment.** Single stage, `node:22-alpine`,
`npm ci --ignore-scripts --omit=dev`, `USER node`, entrypoint `node src/index.js`, now with
`EXPOSE 3000`. There is still no compose file: a compose file encodes a deployment, and
this repository has none. The image was **never built** — Docker is not installed in the
environment this was written in, so neither the `EXPOSE` nor the entrypoint override has
been verified by a build. `.dockerignore` excludes `node_modules`, `test`, `wiki`,
`.agents` and the markdown at the root, which means the image cannot run its own test
suite.

**Version.** `3.2.0`. Releases: `0.0.0` (initial set) through `0.14.0` (the security
creator, and `security/` made servable) are in `wiki/logs/`; `1.0.0` replaced the MCP
server with a read-only instruction set (#63), then restored the `version` and `author`
frontmatter fields on every served file (#64, #65). `2.0.0` made every file its own tool;
`3.0.0` folded the task workflow into `plan-creator`; `3.0.2` corrected the connector
documentation; `3.1.0` adds `github_token_access_guide` and completes the
`auto_activation` routing table; `3.2.0` gates `mcp_list`'s clone behind an explicit user
decision and names the three publishing organisations.

**`master` is at `4437a9a`** as of 2026-09-30. **Re-verify with `git fetch` rather than
trusting this SHA** — an earlier version of this file carried a SHA that went stale within
the hour, and a state file that is confidently wrong is worse than one that says nothing,
because the next session plans a branch point from it. This file also carried the version
as `1.0.0` and denied any deployment, both of which were wrong; the pattern is the same one
the SHA warning describes, and it is why all three are corrected together. **The deployed
tool count went stale for the same reason** — a version asserted in a state file decays
silently, so re-derive it rather than reading it forward.

**Local install has a fixed layout.** A clone that runs this server locally belongs at
`./mcps/{org or owner}/{repo}/`, gitignored. It is a runtime, not a vendored set: the
instructions are still read through the connector, never by file path into the clone. A
committed `./mcps/` is vendoring. See `wiki/guides/install-as-local-mcp.md`.

**Every request has the same shape.** Task 1 is always the task record, task `n` is
always the release, and the work goes between them. Each task appends its own
`### Task k — {branch}` entry to `.agents/memory/tasks/{slug}.md` in the same commit as
its work, so `git log -p` on that file replays the request task by task.

**Tests.** 51, all passing, in two files. `server.test.js` (20) drives a real MCP client on
an in-memory transport; `http.test.js` (31) drives a real client against a real listening
process and a real cluster, because sockets and process boundaries do not reproduce in
memory. A fresh checkout has no
`node_modules` and the suite then fails with `ERR_MODULE_NOT_FOUND` — run `npm install`
first, per `.agents/rules/repository.md`.

**Not built yet.**

* No CI — nothing runs `npm test` on push.
* No migration guide for repositories that already carry an older instruction set.
* No consuming repository has adopted the per-file tool surface yet. Each one has to
  replace its declaration block with the per-file table, and the tool names in an older
  block may not exist.
* `src/tools/instruction.js` is dead code — nothing imports it. It is the old
  path-taking tool, left on disk after #63. Deleting it needs the owner's `git rm`; it was
  not removed unilaterally.
* The `Dockerfile` has never been built. Docker was unavailable in the environment that
  wrote it, and the HTTP work has since added an `EXPOSE` and an entrypoint override that
  are equally unverified. It should be built once, both run forms checked, before anyone
  relies on it.
* The deployed instance is **current with `master`**, checked rather than assumed: on
  2026-09-30 a `tools/list` against the live endpoint returned **34** tools and the served
  `mcp_list` text carried the new gate and all six organisation URLs, at server version
  `3.2.0`. **This entry previously said 32 tools and that the instance predated `3.1.0`;
  that was stale, not wrong at the time** — the same failure mode as the SHA warning below,
  where a state file asserts a version and nobody re-checks it. Re-verify with a
  `tools/list`; `GET /healthz` reports liveness only.

**Next obvious step.** Build the image once and check both run forms, and delete the dead
`instruction.js`.
