---
name: memory-tasks-prefixed-tool-ids
description: Prefixing every tool id with lxagents_skills_shared_instruction_ so ids cannot collide across servers, and moving the automation hub to the new ids.
---

# Prefixed Tool IDs

## 2026-11-11 — in progress

**Goal.** A client that connects several LXAgents servers never sees two tools with the same id.

**Objective.** Every tool id is `lxagents_skills_shared_instruction_{base}`, underscores only,
overrides included. `TOOL_NAME` accepts up to 128 characters. `content/automation.md` keeps its
frontmatter, lists every other file once under its new id, and the tests, `AGENTS.md`, the
`initialize` instructions string and the wiki use the new ids. `npm test` is green.

**Detail.** This repository only; `security` has its own thread. Tool bodies other than the hub
do not change, and neither do the MCP SDK calls. The hub already lists all 47 other files, so no
condition is invented. The longest id is 60 characters, under the 64 many clients enforce.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/prefixed-tool-ids` | — |
| 2 | Prefixed ids and the hub | `feat/prefixed-tool-ids` | — |
| 3 | Documentation | `docs/prefixed-tool-ids` | — |
| 4 | Release | `release/6.0.2` | — |

## Decisions

| # | Decision |
|---|---|
| D1 | The prefix is one exported constant, `TOOL_PREFIX`, and overrides store the base name and are prefixed by the same helper, so the prefix is written once. The exported `NAME_OVERRIDES` values carry the prefix. |
| D2 | `6.0.2`, a patch, by the owner's standing preference — although renaming every tool is breaking for any consumer that calls a tool by its old id. The release log says so under **Consumers must**. |
| D3 | The ids and the hub ship in one commit, because the hub test fails with either one alone. |

## Task entries

### Task 1 — plan/prefixed-tool-ids

Landed: this record and its row in `memory-index.md`.
