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

### Task 2 — feat/prefixed-tool-ids

Landed: `TOOL_PREFIX` and `toolId()` in `src/instructions/from-content.js`; `toolNameFor` returns
`${TOOL_PREFIX}_${base}`; the overrides are base names in `OVERRIDE_BASES`, exported prefixed as
`NAME_OVERRIDES`; `TOOL_NAME` is `{0,127}`. `content/automation.md` keeps its frontmatter and its
47 rows, every id now prefixed (51 ids including the four in its rules). The `initialize` string
names the prefixed hub. Tests assert the prefix and underscores-only, and call tools by
`toolId(base)`; the ends-in-itself detector still matches overridden tools by their base name.
70/70.

### Task 3 — docs/prefixed-tool-ids

Landed: every backticked tool id in `AGENTS.md`, `README.md`, the current wiki pages,
`.agents/rules/content-publishing.md`, `.agents/rules/set-mirrors.md` and `root-index.md` is
the prefixed id; the naming rules in `mcp-surface.md` and `AGENTS.md` state the prefix, and the
`TOOL_NAME` row says `{0,127}`. Release logs, task records and the state file keep the ids they
were written with.

Also on this branch: four HTTP tests read a startup line that a worker writes just after the line
readiness waits for, and failed about once in three runs under parallel suites (the same race fixed
in `6.0.1` for the two-worker test). They now wait for the line. Six consecutive green runs.
