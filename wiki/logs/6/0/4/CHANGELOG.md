# 6.0.4

**Released:** 2026-11-11

**A new tool: `lxagents_skills_shared_instruction_code_optimization`.** It is served from
`content/rules/code-optimization.md` and is about responsibility, coupling, flow and structure,
so it applies in any language and in every consuming repository. It has two parts:

- **Standing rules** that every change obeys when it writes, moves or reviews code. Each file,
  class and function has one responsibility. Effects stay at the edge. Dependencies point one
  way. Each fact has one home. The flow is readable top to bottom. You fix only what your change
  touches, and report anything larger as a hotspot. Because code stays clean as it is written,
  the full audit should rarely be needed.
- **The audit**, which runs only when someone asks to optimize, refactor or restructure, or when
  the reported hotspots add up. It writes no code. It produces a plan for the user to approve:
  current and target structure as text diagrams, ordered steps that each change no behaviour,
  before-and-after snippets, and what was left alone.

The hub routes it in the group "Every session that will change something", so every session that
touches code reads it.

**Consumers must:** nothing. They read the set live and pick the tool up on their next read. A
consumer that declares tools in its own `AGENTS.md` may add the row.

This is a patch, by the owner's standing preference. Strict semver would make a new tool a minor
bump.

## Added

- **`content/rules/code-optimization.md`**, and its hub row in `content/automation.md`.
- **A row in the `AGENTS.md` shared tools table.**

## Changed

- **The image tag** in the README, the Docker page and the security model is now `6.0.4`.

Tests: 74, all passing. The surface is 49 tools.
