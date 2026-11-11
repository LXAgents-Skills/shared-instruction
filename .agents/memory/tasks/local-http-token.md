---
name: memory-tasks-local-http-token
description: Letting HTTP on a loopback address start without MCP_AUTH_TOKEN, while any other bind still requires it; stdio already needed none.
---

# Token Only for Server Installs

## 2026-11-11 — done

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
| 1 | Task record | `plan/local-http-token` | [#14](https://github.com/LXAgents-Skills/shared-instruction/pull/14) |
| 2 | Loopback without a token | `feat/loopback-without-token` | [#15](https://github.com/LXAgents-Skills/shared-instruction/pull/15) |
| 3 | Documentation | `docs/local-http-token` | [#16](https://github.com/LXAgents-Skills/shared-instruction/pull/16) |
| 4 | Release | `release/6.0.3` | [#17](https://github.com/LXAgents-Skills/shared-instruction/pull/17) |

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

### Task 2 — feat/loopback-without-token

Landed: `isLoopbackHost` and `startupTokenProblem` in `src/auth.js`; `createApp({ requireToken })`
in `src/app.js`, open only with `requireToken: false` and no token; `src/http.js` passes it for a
loopback `HOST`, checks `startupTokenProblem(HOST)` in the primary, and logs which mode it is in.
A token-less local server gets the `Host` allow-list `LOOPBACK_HOSTNAMES` (`localhost`,
`127.0.0.1`, `[::1]`) unless `MCP_ALLOWED_HOSTS` is set, against DNS rebinding — matching the
`security` repository. The `security` thread also made `npm run start:http` bind `127.0.0.1`
with a `--host` flag; that is not done here, because the Render service tracks `master` and its
start command is not recorded in this repository, so a default bind change could take it off
`0.0.0.0` unseen. Refusal tests now bind `0.0.0.0`; four tests added. 74/74 on three runs.

### Task 3 — docs/local-http-token

Landed: README, `env.md`, `setup.md`, `install-as-local-mcp.md`, `connect-a-repository.md`,
`mcp-surface.md`, `architecture.md`, `security-model.md` and the repository map say a local
install (stdio, or HTTP on loopback) needs no token and a server does, show the
`HOST=127.0.0.1 npm run start:http` form, and warn against a proxy in front of a token-less
loopback server.

### Task 4 — release/6.0.3

Landed: version `6.0.3`, the image tag, `wiki/logs/6/0/3/CHANGELOG.md`, its row in `logs-index.md`,
and the version line in `repository-state.md`. No tag was created. Pull requests #14 to #17 were merged in order by rebase, each branch rebased onto `master` first.
