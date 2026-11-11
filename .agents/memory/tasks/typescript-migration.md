---
name: memory-tasks-typescript-migration
description: Moving the server and its tests from plain JavaScript to strict TypeScript compiled to dist/, built on npm install, with every dependency at its latest version.
---

# TypeScript Migration

## 2026-11-11 — in progress

**Goal.** The server is written in TypeScript with strict typing, on the latest dependencies, with
no change to what any client sees.

**Objective.** `src/` and `test/` are `.ts`; `tsconfig.json` targets ES2022 with `NodeNext` module
and resolution, `rootDir` `src`, `outDir` `dist`, `strict` on. `npm run build` compiles with no
error, `npm test` passes, and `npm audit` reports no vulnerability. `git clone` followed by
`npm install` yields a runnable `dist/`. The tool surface, every tool id, the SDK calls, both
transports and the environment variables are unchanged.

**Detail.** This repository only; `security`, `template` and `agentic` have their own threads.
The owner's request overrides the "no build step, no TypeScript" line of
`.agents/rules/repository.md`; that rule is rewritten in task 4, and its "no compiled output
committed" half is kept.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/typescript-migration` | |
| 2 | Latest dependencies | `chore/dependencies` | |
| 3 | TypeScript conversion | `refactor/typescript` | |
| 4 | Documentation | `docs/typescript` | |
| 5 | Release | `release/{version}` | |

## Decisions

| # | Decision |
|---|---|
| D1 | `dist/` is not committed. A `prepare` script runs `tsc`, so `npm install` in a fresh clone builds it; `npm publish` runs it too. A committed `dist/` would be a second copy of every source file to keep in step. |
| D2 | Entry points move to `dist/index.js` and `dist/http.js`. A consumer config naming `src/index.js` must change; `ROOT` still resolves to the repository root because `dist/` sits beside `src/`. |
| D3 | Tests import sources through `tsx`; tests that spawn a server process spawn the compiled `dist/` entry points, so the artifact a client runs is the one tested. `pretest` builds first. |
| D4 | The image builds in a first stage and copies `dist/` into a runtime stage that still installs with `npm ci --ignore-scripts --omit=dev` and runs as `USER node`. |
| D5 | `6.0.5`, a patch, by the owner's standing preference, even though entry-point paths move. |

## Task entries

### Task 1 — plan/typescript-migration

Landed: this record and its row in `memory-index.md`.
