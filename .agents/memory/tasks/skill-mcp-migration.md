---
name: memory-tasks-skill-mcp-migration
description: Moving the repository to the LXAgents-Skills organization and the "Skill MCP instruction" vocabulary while the MCP SDK surface stays intact.
---

# Migrate to Skill MCP Instructions

## 2026-11-11 — done

**Goal.** The repository names its new home, `LXAgents-Skills`, and describes what it serves as
Skill MCP instructions rather than MCP tools.

**Objective.** No current file names `LXAgents-MCP` or `@lxagents-mcp`; the surface builder lives
in `src/instructions/` and exports `CONTENT_INSTRUCTIONS` and `INSTRUCTION_FILES`, with
`src/server.js` exporting `INSTRUCTION_MODULES`; the prose in `content/`, `wiki/` and `AGENTS.md`
uses the new terms; `npm test` is green; every change is committed locally.

**Detail.** Edit this repository only — `security` has its own thread. The
`@modelcontextprotocol/sdk` dependency and its methods (`registerTool`, `listTools()`,
`tools/list`, `tools/call`) are untouched: the wire schema stays MCP. The owner first asked for local commits,
then for the pull requests to be merged in order with a rebase.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/skill-mcp-migration` | [#1](https://github.com/LXAgents-Skills/shared-instruction/pull/1) |
| 2 | Organization scope | `chore/org-scope` | [#2](https://github.com/LXAgents-Skills/shared-instruction/pull/2) |
| 3 | Instructions in code | `refactor/instructions` | [#3](https://github.com/LXAgents-Skills/shared-instruction/pull/3) |
| 4 | Skill MCP terminology | `docs/skill-mcp-terminology` | [#4](https://github.com/LXAgents-Skills/shared-instruction/pull/4) |
| 5 | Release | `release/6.0.0` | [#5](https://github.com/LXAgents-Skills/shared-instruction/pull/5) |

Branches stack: task 1 from `master`, task `k` from task `k-1`.

## Decisions taken without the owner, who was away

| # | Decision |
|---|---|
| D1 | Convention-named stacked branches, not the harness-named `claude/…` branch. |
| D2 | Release logs under `wiki/logs/` and closed task records under `.agents/memory/tasks/` keep `LXAgents-MCP`: they record what was true when written, and rewriting history makes them false. |
| D3 | "MCP" becomes "Skill MCP" only where it names this server or its connector. The protocol itself, the SDK, the MCP Inspector, and generic MCP servers in `skills/engineering/` keep "MCP" — they are not ours to rename. |
| D4 | Tool-validation code that enforces the MCP wire format (`TOOL_NAME`) keeps its name, because it checks an MCP tool name, not a domain concept. |
| D5 | `6.0.0`. The owner asked for the version to be decided; the package rename and the `src/` path change are breaking, so it is a major. |

## Task entries

### Task 1 — plan/skill-mcp-migration

Landed: this record and its row in `memory-index.md`.

### Task 2 — chore/org-scope

Landed: `LXAgents-MCP` → `LXAgents-Skills` and `@lxagents-mcp/` → `@lxagents-skills/` in 15
current files, including `package.json`, `package-lock.json`, `README.md`, `AGENTS.md` and two
`content/` files. The git remote already pointed at `LXAgents-Skills`. The Render hostname
`lxagents-mcp-shared-instruction.onrender.com` is a deployed address, not a name, and is kept.

### Task 3 — refactor/instructions

Landed: `src/tools/` is `src/instructions/` (a `git mv`, so history follows). `TOOL_MODULES` is
`INSTRUCTION_MODULES`, `CONTENT_TOOLS` is `CONTENT_INSTRUCTIONS`, `TOOL_FILES` is
`INSTRUCTION_FILES`, and `buildContentTools` is `buildContentInstructions`, in `src/`, both test
files, and every page that names them. `server.registerTool`, `listTools()`, the `tools/list` and
`tools/call` methods, and `TOOL_NAME` (it validates the MCP wire name) are unchanged. 70/70 tests
pass.

### Task 4 — docs/skill-mcp-terminology

Landed: "MCP" → "Skill MCP" where it names this server — `README.md`, `AGENTS.md`, the wiki
pages, the `instructions` string clients receive at `initialize`, and the HTTP startup line
(`serving Skill MCP over http on …`, with the tests that match it). "shared tool" → "shared
instruction" and "tool call" → "instruction call" in `AGENTS.md`, `README.md` and the wiki.
`content/` held none of the listed phrases outside generic MCP-server guidance, which keeps "MCP"
(D3), so `content/` changed only in task 2. 70/70 tests pass.

### Task 5 — release/6.0.0

Landed: `package.json` and `package-lock.json` at `6.0.0`, the image tag in `README.md` and two
wiki pages, `wiki/logs/6/0/0/CHANGELOG.md`, its row in `logs-index.md`, and the version line in
`repository-state.md`. No tag was created. Pull requests #1 to #5 were merged in order by rebase, each branch rebased onto `master` first, at the owner's request.
