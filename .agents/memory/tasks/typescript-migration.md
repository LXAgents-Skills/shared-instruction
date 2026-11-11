---
name: memory-tasks-typescript-migration
description: Moving the server and its tests from plain JavaScript to strict TypeScript compiled to dist/, built on npm install, with every dependency at its latest version.
---

# TypeScript Migration

## 2026-11-11 — done

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
| 1 | Task record | `plan/typescript-migration` | [#22](https://github.com/LXAgents-Skills/shared-instruction/pull/22) |
| 2 | Latest dependencies | `chore/dependencies` | [#23](https://github.com/LXAgents-Skills/shared-instruction/pull/23) |
| 3 | TypeScript conversion | `refactor/typescript` | [#24](https://github.com/LXAgents-Skills/shared-instruction/pull/24) |
| 4 | Documentation | `docs/typescript` | [#25](https://github.com/LXAgents-Skills/shared-instruction/pull/25) |
| 5 | Release | `release/6.0.5` | [#26](https://github.com/LXAgents-Skills/shared-instruction/pull/26) |

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

### Task 2 — chore/dependencies

Landed: `@modelcontextprotocol/sdk` `^1.32.2`, `express` `^5.3.0`, `zod` `^4.6.7`, each the
latest on the registry, and `npm audit fix` for the transitive tree. `npm audit` went from 8
vulnerabilities (3 high, 5 moderate: among them `zod` below 4.6.6, `hono`, `ip-address`, `qs`)
to 0. `npm outdated` is empty. 74/74 tests unchanged.

### Task 3 — refactor/typescript

Landed: every file in `src/` and `test/` renamed to `.ts` (`git mv`, so history follows) and
typed under `strict`. `tsconfig.json` (ES2022, `NodeNext`, `src` → `dist`) builds the server;
`tsconfig.test.json` extends it with `noEmit` over `src` and `test`, so the tests are held to
the same strictness. Dev dependencies: `typescript` 7.0.2, `@types/node` 26.6.6,
`@types/express` 5.0.6, `tsx` 4.23.15. `package.json`: `main` and `bin` → `dist/index.js`,
`files` ships `dist` instead of `src`, scripts `build`, `prepare`, `typecheck`, `start*` and
`inspect` on `dist/`, `pretest` builds and type-checks, `test` runs `node --import tsx --test`.
`dist/` is in `.gitignore` and `.dockerignore`. The Dockerfile is two stages (D4).

Types added, logic untouched: `AppOptions`/`RequestCloser` (app), `InstructionTool`/
`InstructionConfig` (from-content), `PackageManifest` (version), a typed harness
(`RunningServer`, `ServerOptions`, `ExitStatus`, `RunResult`). One dead argument removed:
`server.ts` passed `inputSchema: config.schema`, and `config` never had a `schema`, so it was
always `undefined`; the tool surface is unchanged.

Verified: `npm run build` clean; `npm test` 74/74 (the baseline count) with the process tests
spawning `dist/`; `npm audit` 0. Tool surface compared against `master` over stdio — 49 tools,
names, descriptions, input schemas, every body, server name and instructions — one sha256 for
both. Both image stages replayed by hand outside Docker (stdio lists 49 tools, HTTP `/healthz`
answers); `docker build` itself could not run here, because Docker Hub answered 429.

Left: `test/http.cluster.test.ts` reads `transport.stdout`, which `StdioClientTransport` does
not have, so that capture has always been a no-op. Kept as it was, with a cast and a comment.

### Task 4 — docs/typescript

Landed: every page that named a source file now names its `.ts` path, and every runnable path
(a client config, `node … http.js`, the Docker override) names `dist/`. README, `AGENTS.md`,
`architecture.md`, `setup.md`, `env.md`, `docker.md`, `install-as-local-mcp.md`,
`connect-a-repository.md`, `mcp-surface.md`, `security-model.md`, the repository map,
`security-boundaries.md`, `content-publishing.md` and `set-mirrors.md`. `.agents/rules/repository.md`
now describes the TypeScript stack (D1–D3) in place of "no build step, no TypeScript", keeps
"no compiled output committed", and adds "no `any`". `install-as-local-mcp.md` said 19 passing
tests; it says 74. Release logs, memory and the logs index are history and were left as written.
Nothing under `content/` changed.

### Task 5 — release/6.0.5

Landed: version `6.0.5` in `package.json` and the lockfile, the image tag in the README, the
Docker page and the security model, `wiki/logs/6/0/5/CHANGELOG.md`, its row in `logs-index.md`
(with the `6.0.4` row that release left out), the version line in `repository-state.md`, and the
PR column above. No tag was created.
