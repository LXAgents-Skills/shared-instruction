# 6.0.1

**Released:** 2026-11-11

An internal cleanup. **The served surface is identical to `6.0.0`**: the same tools, the same text,
the same responses, and the same configuration.

**Consumers must:** nothing. Pull `lxagents-shared-instruction:6.0.1` if you pin the image tag.

## Added

- **`src/rpc-error.js`**, the one place the JSON-RPC error envelope is built. Before this,
  `src/app.js` and the token check in `src/auth.js` each built it by hand.
- **`test/helpers/http-harness.js`**, which holds the test token, the entry points, and the
  helpers that start a real server as a child process and connect to it.

## Changed

- **The HTTP suite is split by subject.** `test/http.test.js` (1476 lines) is now
  `http.routes`, `http.hosts`, `http.limits`, `http.cluster` and `http.auth`, and the test bodies
  are unchanged.
- **`npm test` runs `node --test test/*.test.js`.** A bare `node --test` runs every `.js` under
  `test/`, so it would have counted the harness as a suite.
- **The two-worker test waits for the second worker's allow-list warning** instead of counting it
  immediately. That race was latent, and running the suites in parallel exposed it once in five runs.

## Removed

- `test/http.test.js`, replaced by the five files above.

Tests: 70, unchanged in number. All passed on six consecutive runs.
