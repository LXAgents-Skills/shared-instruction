---
name: memory-tasks-code-optimization-tool
description: Adding a language-agnostic code-optimization (SRP) tool to the shared set, routed from the hub for every session that touches code.
---

# Code Optimization Tool

## 2026-11-11 — done

**Goal.** The code-optimization analysis the owner asked for by hand in `code-optimization.md`
becomes a standing instruction, so no one has to request it again.

**Objective.** A new published tool, `lxagents_skills_shared_instruction_code_optimization`,
served from `content/rules/code-optimization.md`. It is about responsibility, coupling, flow and
structure, not about any language, so it applies to every consuming repository. It carries two
parts: standing rules that every code change obeys, which keep the codebase from decaying, and
the full audit procedure, which runs only on request or when the standing rules find a hotspot.
The hub routes it under "Every session that will change something". `npm test` is green.

**Detail.** This repository only. `security` and every other consumer read the shared set
through the connector and pick the tool up on their next read with no change.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/code-optimization-tool` | [#18](https://github.com/LXAgents-Skills/shared-instruction/pull/18) |
| 2 | Tool and hub row | `feat/code-optimization-tool` | [#19](https://github.com/LXAgents-Skills/shared-instruction/pull/19) |
| 3 | Documentation | `docs/code-optimization-tool` | [#20](https://github.com/LXAgents-Skills/shared-instruction/pull/20) |
| 4 | Release | `release/6.0.4` | [#21](https://github.com/LXAgents-Skills/shared-instruction/pull/21) |

## Decisions

| # | Decision |
|---|---|
| D1 | One file, two parts. The standing rules are what make the audit rare; splitting them into two tools would let a session read the audit and skip the rules. |
| D2 | Routed from the hub, not loaded at session start. The hub is read every session and already fires the tool on any code change; loading it unconditionally would charge sessions that never touch code. |
| D3 | `content/rules/`, because it is a convention every repository follows, not a skill for a tool or format. |
| D4 | `6.0.4`, a patch, by the owner's standing preference. A new tool would be a minor bump under strict semver. |

## Task entries

- Landed as `6.0.4`. `content/rules/code-optimization.md`, its hub row, an `AGENTS.md` row. 49 tools, the longest id 60 characters. Tests: 74, all passing.
