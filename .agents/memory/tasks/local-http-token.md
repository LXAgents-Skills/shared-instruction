---
name: memory-tasks-local-http-token
description: Letting HTTP on a loopback address start without MCP_AUTH_TOKEN, while any other bind still requires it; stdio already needed none.
---

# Token Only for Server Installs

## 2026-11-11 — in progress

**Goal.** A local install never asks for `MCP_AUTH_TOKEN`; a server install always does.

**Objective.** stdio needs no token (already true, and tested). HTTP bound to a loopback address
(`127.0.0.1`, any `127.x.x.x`, `localhost`, `::1`) starts without a token and says so on startup.
If a token is set there, it is still enforced, and an unusable one is still refused. HTTP on any
other address, including the default `0.0.0.0` and every container, refuses to start without a
usable token exactly as before. `npm test` is green.

**Detail.** This repository only; `security` has its own thread. The owner's request overrides
D2 of `http-token-auth.md`, which refused a loopback waiver because a reverse proxy on the same
host would turn it into an open door. That risk is stated in the security model and the release log.

## Tasks

| # | Title | Branch | PR |
|---|---|---|---|
| 1 | Task record | `plan/local-http-token` | — |
| 2 | Loopback without a token | `feat/loopback-without-token` | — |
| 3 | Documentation | `docs/local-http-token` | — |
| 4 | Release | `release/6.0.3` | — |

## Decisions

| # | Decision |
|---|---|
| D1 | The bind address decides, not a new mode variable: a loopback bind cannot be reached from another machine, which is what "local" means. |
| D2 | A token set on loopback is enforced and validated. Setting one is a request for it; ignoring it would be a silent downgrade. |
| D3 | `createApp()` still refuses to build without a token by default; the open form needs an explicit `requireToken: false`, so an unauthenticated app cannot come from a forgotten option. |
| D4 | `6.0.3`, a patch, by the owner's standing preference. |

## Task entries

### Task 1 — plan/local-http-token

Landed: this record and its row in `memory-index.md`.
