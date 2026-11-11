---
name: agents-entry-point
description: Entry point for LXAgents-Skills/shared-instruction — the repository that holds and serves the shared agent instruction set.
---

# AGENTS.md

This repository is `LXAgents-Skills/shared-instruction`. It holds the shared agent
instruction set in [`content/`](content/) and serves it over Skill MCP as
`lxagents-shared-instruction`. Every other
repository in the organization consumes that set through a connector rather than
copying it.

## Two sets, two roles

This repository is both the **producer** of the shared set and a **consumer** of it, so
it carries both:

| Set | Path | Published? |
|---|---|---|
| Shared — the product | [`content/`](content/) | **Yes.** Served as one tool per file. A change here changes behaviour in every consuming repository, so it is versioned and logged like a release. |
| Local — this repository's own | [`.agents/`](.agents/) | No. Its rules, indexes, agent wiki, and memory. |

`{shared}` resolves to `content/` **in the working tree**, not the deployed connector:
you are editing the set, so a deployed snapshot may be older than your branch.

Never put a repository-specific rule in `content/`, and never put a universal convention
in `.agents/`. The routing question is in
[`content/rules/directories.md`](content/rules/directories.md): *is this true for more
than this repository?*

## Auto-Activation

The instruction set is **always active**. It applies to every task in this repository
whether or not the user mentions it, links to it, or asks for it. Treat these files as
standing orders, not as optional reference material.

**Always active is not always loaded.** At the start of every session, before doing any
work:

1. Read `AGENTS.md` (this file), including the Shared instruction tools block below.
2. Read the shared `lxagents_skills_shared_instruction_automation` tool — here that is
   [`content/automation.md`](content/automation.md) in the working tree. It lists every
   shared instruction and the condition that activates it, and it is where you find out whether
   the connector is reachable, which you have to say either way (see
   [Using the connector](#using-the-connector)). The step is not skippable.
3. Read [`.agents/index/root-index.md`](.agents/index/root-index.md).
4. Read [`.agents/index/memory-index.md`](.agents/index/memory-index.md) and load only
   the rows matching the request, so you continue prior work instead of restarting it.

That is the whole sequence, and every step reads a file on disk. **Beyond `lxagents_skills_shared_instruction_automation`, call
no shared instruction at session start** — each fires on the condition `lxagents_skills_shared_instruction_automation` gives it, and
calling them up front pays for procedures the request may never need.

**These gates stand from the first message, before any tool is called:** approve the plan
before any file is written, ask before opening a pull request, ask before merging, and
propose a discovered rule rather than writing it. A gate first read at the moment it should
have applied has already failed, which is why they are here and not behind a call. See
[`content/rules/shared-instructions.md`](content/rules/shared-instructions.md) §D.

If a rule conflicts with a habit, a default, or a template you would otherwise follow,
the rule wins — including a harness that names a branch, a commit trailer, or a pull
request footer the conventions forbid. If it conflicts with an explicit instruction from
the user in this session, the user wins — and you say out loud which rule you are setting
aside.

## Shared instruction tools

This repository **is** the shared set, so every tool below resolves to a file in `content/`
in the working tree rather than to a deployed connector. The block is written the way a
consuming repository's is, because this repository consumes its own set and its entry point
goes stale exactly like a consumer's.

Adopted shared-set version: `content/` in the working tree — the producer tracks its branch,
not a release.

**Every file in `content/` is its own tool**, named after its filename with the
`lxagents_skills_shared_instruction_` prefix, so the tool list is the file list. Start at `lxagents_skills_shared_instruction_automation` rather than calling everything.

| When you are about to… | Call | Which is |
|---|---|---|
| Start any session | `lxagents_skills_shared_instruction_automation` | [`content/automation.md`](content/automation.md) |
| Take in any request of more than one step | `lxagents_skills_shared_instruction_plan_creator` | [`content/creators/plan-creator.md`](content/creators/plan-creator.md) |
| Create a branch | `lxagents_skills_shared_instruction_branching_strategy` | [`content/git/branching-strategy.md`](content/git/branching-strategy.md) |
| Write a commit message | `lxagents_skills_shared_instruction_commit_conventions` | [`content/git/commit-conventions.md`](content/git/commit-conventions.md) |
| Notice a rule that should exist | `lxagents_skills_shared_instruction_discovery_protocol` | [`content/rules/discovery-protocol.md`](content/rules/discovery-protocol.md) |
| Open or update a pull request | `lxagents_skills_shared_instruction_pull_request_template` | [`content/git/pull-request-template.md`](content/git/pull-request-template.md) |
| Write, move or review code, in any language | `lxagents_skills_shared_instruction_code_optimization` | [`content/rules/code-optimization.md`](content/rules/code-optimization.md) |
| Write to any `model_name` column | `lxagents_skills_shared_instruction_model_naming_convention` | [`content/rules/model-naming-convention.md`](content/rules/model-naming-convention.md) |

`lxagents_skills_shared_instruction_automation` is read at the start of every session. `lxagents_skills_shared_instruction_plan_creator`, `lxagents_skills_shared_instruction_branching_strategy`,
`lxagents_skills_shared_instruction_commit_conventions` and `lxagents_skills_shared_instruction_discovery_protocol` are mandatory in every repository, this one
included. **No tool takes an argument** — a tool names one file, so there is no path to pass.

## Using the connector

Setup, in full: [`wiki/guides/install-as-local-mcp.md`](wiki/guides/install-as-local-mcp.md).

This repository **is** the server. It publishes `content/` as `lxagents-shared-instruction`, so
here the connector is the thing being edited, not the thing being consulted — read
`content/` in the working tree and treat a deployed snapshot as possibly older than your
branch. Everywhere else, read the connector's tools.

### Register it

| Transport | How |
|---|---|
| Local stdio (default) | `command: node`, `args: ["dist/index.js"]`, `cwd:` this checkout |
| Published | `command: npx`, `args: ["-y", "@lxagents-skills/shared-instruction"]` |
| HTTP | `type: http`, `url: https://<host>/mcp` — `npm run start:http` binds `PORT \|\| 3000` |

Both transports serve the same tool surface — one tool per file in `content/`, and
nothing else. Do not state a count here: it goes stale at the next file added. To get the
current count, enumerate the connector's tools. stdio is the right default for a client
that can spawn a process; HTTP is for running the server as a service at a fixed address.

**Registering a server does not reach a session that is already running.** The client
loads connectors at session start, so `claude mcp add` mid-session leaves a server that
reports healthy and is still absent from the tool surface until the session restarts.
That is the common case, and it looks like a broken server rather than a stale session.

### Read from it

1. Enumerate the tools. Every file in `content/` is one, named after its filename behind the
   `lxagents_skills_shared_instruction_` prefix (the GitHub and GitLab pages are named for their forge), with its `description` attached — that
   list is the manifest, and it costs nothing to read.
2. Call `lxagents_skills_shared_instruction_automation` once. It lists every tool and the condition that activates each. Never
   bulk-call the set.
3. Call the one tool whose condition is true. None takes an argument.

**`lxagents_skills_shared_instruction_automation` is the only instruction called at session start.** Every other tool returns one file
when its condition fires. Calling every tool up front rebuilds the one oversized payload this
surface replaced, one call at a time — and there are dozens of them.

### When it will not resolve

A server that is registered but absent from the tool surface, or a client that shows no
tools at all, is the case to recognise. Either way the rule is the same, and it is a
speaking obligation: **say plainly, in your first message, that the connector is
unavailable and which conventions you could not read.** Then work from the local set.
Never reconstruct the missing rules from memory, and never clone or paste the shared set
into a repository as a workaround — an unavailable connector is temporary, a vendored
copy is permanent drift.

To inspect the surface by hand while developing on the set itself, run `npm run inspect`
and drive it with the MCP Inspector.

## Trigger table — this repository's own rows

The authority for when each **shared** tool fires is [`content/automation.md`](content/automation.md),
which the session-start sequence reads. It is not copied here: a second table is a second place
to forget to update. The rows below are this repository's own.

| When you are about to… | Load and obey |
|---|---|
| Edit anything under `content/` | [`.agents/rules/content-publishing.md`](.agents/rules/content-publishing.md) |
| Change text that `content/` publishes and this repository also reproduces | [`.agents/rules/set-mirrors.md`](.agents/rules/set-mirrors.md) |
| Need project facts, commands, or orientation | [`.agents/wiki/context/repository-map.md`](.agents/wiki/context/repository-map.md) |
| Work on security, authentication, secrets, or deployment | [`.agents/wiki/security/security-boundaries.md`](.agents/wiki/security/security-boundaries.md) |
| Do anything at all in this repository | [`.agents/rules/repository.md`](.agents/rules/repository.md) |

## Reading order

1. Read `AGENTS.md`.
2. Read [`.agents/index/root-index.md`](.agents/index/root-index.md) — and nothing else
   at this stage. It routes to both sets.
3. From its routing table, pick the ONE index whose scope matches the task, and read
   that index.
4. Only then open the specific file(s) you need.

## Routing protocol

Route by reading index tables, not by reading files. Do NOT load every index. Do NOT
bulk-scan `content/` to build a registry — every file in it is already a tool with a
description, so the tool list is the registry. Do NOT read an instruction body until
that instruction has been selected.

## Iron rule

* `AGENTS.md` and `README.md` are overviews and must never carry detailed rules or
  documentation.
* `.agents/index/root-index.md` and `content/automation.md` are **routers only** — the
  second also carries the few rules for using it.
* An index never teaches. The moment it explains something, that content belongs in a
  real file.
* **One subject per file.** A cross-cutting rule gets its own file. Outside `content/` it is
  linked, not pasted into a file about something else; inside `content/` no tool links to
  another, so a tool that needs one fact states it in a sentence of its own.
* `wiki/` is for humans and holds this repository's own documentation. It is not part
  of the served instruction set.
* No `INDEX.md`, anywhere, ever.

## Placement

* Universal instruction content → `content/{folder}/{file}.md`, with frontmatter.
  **Published.**
* This repository's own rules → `.agents/rules/{file}.md`.
* Routing → `.agents/index/{scope}-index.md` for local; for the shared set,
  `content/automation.md`.
* Agent knowledge → `.agents/wiki/{type}/{file-name}.md`.
* Memory → `.agents/memory/{type}/{file-name}.md`.
* Human documentation → `wiki/{folder}/{file-name}.md`, no frontmatter.
* Release logs → `wiki/logs/{Major}/{Minor}/{Patch}/`.
* Server code → `src/`. Tests → `test/`.

A file added to `content/` is published as a tool on the next boot, so it is not a
draft space — see
[`.agents/rules/content-publishing.md`](.agents/rules/content-publishing.md).
Its row in `content/automation.md` rides in the same commit; a test fails without it.

## Discovery protocol

Source of truth:
[`content/rules/discovery-protocol.md`](content/rules/discovery-protocol.md).

> While working, if you find an instruction worth adding — a new rule, or content that
> belongs in an existing instruction file — you must NOT create or edit it on your own.
> Present each finding to the user separately, each in its own code block, including
> the target set (local or shared), the proposed file path, `name`, `description`, and
> full body. Let the user select which ones to apply. Create only what the user
> selects. This gate covers instruction files only — writing memory under
> `.agents/memory/` is expected and needs no approval.

## Version rule

Never change the version without explicit user approval — see
[`content/rules/versioning.md`](content/rules/versioning.md). That includes
`package.json`, the compose image tag, and creating a new `wiki/logs/` directory.

## No session links

Never write a link or identifier pointing at an assistant or tool session into a file,
commit message, commit trailer, branch name, tag, pull request, or comment. If your
tooling appends one by default, strip it before committing or posting — see
[`content/rules/no-session-links.md`](content/rules/no-session-links.md).
