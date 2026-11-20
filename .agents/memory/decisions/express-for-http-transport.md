---
name: memory-decisions-express-for-http-transport
description: Why express became the third runtime dependency, for the HTTP transport.
---

# express as a third runtime dependency

> **Superseded in 6.0.6.** The server is Rust now and has no express; see
> [`rust-rmcp-and-axum.md`](rust-rmcp-and-axum.md). Kept as the record of the Node design.

`.agents/rules/repository.md` states the runtime dependencies are the MCP SDK and zod, and
that adding a third "needs a reason in `.agents/memory/decisions/`". This is that reason.

> **Superseded in part, not replaced.** The decision stands: express is still a production
> dependency, for the same reasons, and nothing here is retracted. Two sentences below became
> false when the SSE transport was replaced by a stateless `POST /mcp`, and they are marked
> where they are wrong. A superseded decision that is still on disk is the record of why this
> repository looked the way it did — deleting it would leave a reader with a `git log` entry
> and no explanation. See
> [`../tasks/sse-to-mcp-transport.md`](../tasks/sse-to-mcp-transport.md).

**Decision.** `express@^5.2.1` is a production dependency, used by the HTTP transport.

**Why it is not a dependency added to serve one call site.** That clause is the rule's
rationale, and it is not what happened. The HTTP entry point uses express for four
distinct things: the `/mcp` and `/healthz` routes (formerly the `/sse` and `/message`
routes), JSON body parsing with a declared size limit, the `hostHeaderValidation`
middleware, and error handling. Removing it would mean reimplementing all four against
`node:http`.

**Why the SDK's own helper rather than hand-rolled middleware.** The SDK ships
`createMcpExpressApp`, which returns a configured `Express` with DNS-rebinding protection
already applied. Writing the `Host` allow-list by hand is exactly the kind of security
control that looks right until someone gets the normalisation wrong, and the SDK's version
is the one its own maintainers test. `hostHeaderValidation` is the supported replacement
for `SSEServerTransport`'s deprecated `allowedHosts` option, for the same reason — and
with `SSEServerTransport` gone it is now the only `Host` control here, mounted by
`src/app.js` on the same condition as before.

**The cost is smaller than it looks.** `express@5.2.1` was already resolved in
`package-lock.json` as a transitive dependency of `@modelcontextprotocol/sdk`. Promoting it
to a direct dependency changes no installed version and introduces no new transitive graph
— verified against the lockfile before and after. The rule exists to stop dependencies
accumulating unnoticed; this one was already there, and naming it is the honest response to
that.

**What would invalidate this.** If the HTTP transport is ever deleted — `src/http.js` and
`src/app.js` together — so is this decision, and `express` should leave `package.json` in
the same commit that removes the last use of it. **Corrected 2026-09-29:** this originally
named `src/http.js` alone, which was the whole of the HTTP transport then and is half of it
now. `src/app.js` holds the application; `src/http.js` holds the port, the startup lines
and the drain. Deleting one of them without the other does not remove the last use.
