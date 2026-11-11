# 6.0.3

**Released:** 2026-11-11

**A local install no longer needs `MCP_AUTH_TOKEN`.** stdio never needed it. HTTP bound to a
loopback `HOST` (`127.0.0.1` or any other `127.x.x.x`, `localhost`, or `::1`) now starts without
one and says so on startup. A server install still needs it: HTTP on any other address, including
the default `0.0.0.0` and every container, refuses to start without a usable token, exactly as in
`5.0.0` and later.

A token-less local server answers only to a `Host` of `localhost`, `127.0.0.1` or `[::1]`, unless
`MCP_ALLOWED_HOSTS` says otherwise. This keeps a web page in the same machine's browser from
reaching it through DNS rebinding. If a token is set on loopback, it is enforced, and one shorter
than 32 characters is still refused.

**Consumers must:** nothing, if they run as a server, because behaviour off loopback is unchanged.
To run locally over HTTP without a token, start with `HOST=127.0.0.1 npm run start:http` and leave
the `Authorization` header out of the client entry. **Never put a reverse proxy, tunnel or
port-forward in front of a token-less loopback server**, because that makes it an open server. Set
the token first.

This reverses decision D2 of the `5.0.0` record, which refused a loopback waiver for exactly that
proxy risk. The owner asked for it, and the warning above, the startup line and the security model
carry the risk instead.

## Added

- **`isLoopbackHost` and `startupTokenProblem`** in `src/auth.js`.
- **`createApp({ requireToken })`.** It builds an open app only with `requireToken: false` and no
  token, so an unauthenticated app still cannot come from a forgotten option.
- **`LOOPBACK_HOSTNAMES`** in `src/app.js`, the default `Host` allow-list for a token-less local
  server.
- **Four tests:**
  - loopback without a token is served and says so
  - its `Host` check refuses a foreign name
  - a token set on loopback is enforced and validated
  - the loopback and startup rules as units

## Changed

- **Startup lines.** A local server says it has no bearer token and that only this machine can
  connect. A refusal names the host it refused on and the local alternative.
- **Refusal tests now bind `0.0.0.0`**, which is the server case.
- **The README, the environment, setup and install pages, and the security model** describe the
  two cases.

Tests: 74, all passing.
