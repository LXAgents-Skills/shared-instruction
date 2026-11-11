---
name: root-index
description: Router for LXAgents-Skills/shared-instruction — every local index, the shared set, and the override table.
---

# Root Index

This file lists indexes only. Never rules, never documentation, never leaf content.
Read exactly one branch per task, plus `memory-index.md`.

## Indexes

| Index | Scope | Load when |
|---|---|---|
| [`agents-index.md`](agents-index.md) | `.agents/` — this repository's own instruction set | You need a rule specific to this repository, including anything about publishing `content/`. |
| [`../../content/automation.md`](../../content/automation.md) | `content/` — the shared instruction set this repository publishes; the `lxagents_skills_shared_instruction_automation` tool lists every shared tool and when it fires | You need a branching, commit, pull request, planning, or creator convention. |
| [`agent-wiki-index.md`](agent-wiki-index.md) | `.agents/wiki/` agent knowledge | You need orientation before touching code. |
| [`project-wiki-index.md`](project-wiki-index.md) | `wiki/` human documentation | You need to read or write documentation a person will read. |
| [`memory-index.md`](memory-index.md) | `.agents/memory/` dynamic state | You need prior task state, or must record progress. |
| [`logs-index.md`](logs-index.md) | `wiki/logs/` versioned change logs | You need release history, or must record a release. |

The shared set resolves to `content/` **in the working tree**, not the deployed
connector — this repository produces the set, so the working tree is the authority.

## Shared overrides

| `name` | Local file | Replaces | Why |
|---|---|---|---|

No overrides — this repository uses the shared set unchanged. `repository-rules`,
`content-publishing`, and `set-mirrors` are additions, not overrides: none of those
`name`s exists in `content/`.

## Maintenance

* Adding, removing, or renaming any index updates this table **in the same commit**.
* Adding or dropping an override updates the override table in the same commit.
