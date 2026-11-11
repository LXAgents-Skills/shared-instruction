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
