---
name: memory-tasks-code-optimization
description: The 6.0.1 cleanup — the HTTP test suite split by subject and one home for the JSON-RPC error envelope, with no change to the served surface.
---

# Code Optimization

## 2026-11-11 — in progress

**Goal.** Every file in `src/` and `test/` has one subject, and no shape is built in two places.

**Objective.** `test/http.test.js` is split into one file per subject plus a shared harness, with
the same 70 tests passing. The JSON-RPC error envelope is built by one function, used by both
`src/app.js` and `src/auth.js`. The published surface and every response body are unchanged.

**Detail.** The analysis is in the project report `shared-instruction-code-optimization-plan.md`.
Items 3 (one signal helper in `http.js`) and 4 (trimming historical comments) are left out:
the first would hide more than it saves, and the second is wording, not structure. The owner set
the version to a patch.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/code-optimization` | — |
| 2 | Split the HTTP suite | `test/http-suite-split` | — |
| 3 | One JSON-RPC error helper | `refactor/rpc-error` | — |
| 4 | Release | `release/6.0.1` | — |

Branches stack: task 1 from `master`, task `k` from task `k-1`.

## Task entries

### Task 1 — plan/code-optimization

Landed: this record and its row in `memory-index.md`.

### Task 2 — test/http-suite-split

Landed: `test/http.test.js` (1476 lines, 47 tests) is five files — `http.routes` (11),
`http.hosts` (6), `http.limits` (4), `http.cluster` (10), `http.auth` (16) — and
`test/helpers/http-harness.js`, which holds the token, the entry points and every helper. Test
bodies moved unchanged with one exception: the two-worker test now waits for the second worker's
allow-list warning instead of counting it immediately. Running the files in parallel exposed that
race once in five runs; it was latent before. `npm test` is now `node --test test/*.test.js`, because
bare `node --test` runs every `.js` under `test/`, the harness included, and reported 71. 70 tests,
green on six consecutive runs. The pages that described the old file are updated.

### Task 3 — refactor/rpc-error

Landed: `src/rpc-error.js` exports `rpcError`. `src/app.js` imports it instead of defining it,
and `src/auth.js` uses it for the `401` instead of building the envelope a second time. Every
response body, status and header is unchanged, and the tests that pin them pass without edits.
70/70.
