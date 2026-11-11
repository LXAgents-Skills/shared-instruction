import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { configuredToken, requireBearerToken, tokenProblem } from "./auth.js";
import { rpcError } from "./rpc-error.js";
import { createServer } from "./server.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * The HTTP transport, as an application.
 *
 * This module builds an express app and returns it. **It does not listen** —
 * `src/http.js` owns the port. A file that both builds the app and binds a port cannot
 * be reasoned about, or tested, without binding one.
 *
 * The surface is deliberately narrow: `POST /mcp` and `GET /healthz`, a JSON-RPC 405 for
 * any other method on `/mcp`, a JSON-RPC 404 for everything else, and one answer for a
 * body the transport cannot read. **Everything except `GET /healthz` needs the bearer
 * token** — see `src/auth.js` for why, and `createApp` for where. Nothing here is a second
 * source of truth about the tool
 * list — `createServer()` is the same factory `src/index.js` uses on stdio, and it
 * returns a fresh `McpServer` per call, so each request gets its own. Sharing one across
 * requests would be a real bug: `McpServer` holds per-connection state.
 */

/**
 * The request body ceiling, in bytes.
 *
 * **New on this route, and stated rather than inherited.** The SSE transport this
 * replaces parsed its own bodies with the SDK's default, which is effectively unbounded,
 * so an unauthenticated public port accepted whatever a caller chose to send. The number
 * is 4 MB — the smallest that holds a legitimate `tools/call` against this set with
 * enormous room to spare, and the point at which "somebody is not calling this server".
 */
export const BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * The `Host` header allow-list, when one is configured.
 *
 * This is the control that used to default to off. The removed implementation shipped
 * `MCP_DNS_REBINDING_PROTECTION` defaulting to `false`, which made its allow-lists inert
 * — see `.agents/memory/tasks/activation-security.md`.
 *
 * Unset — or set to nothing but commas and spaces — means the check is skipped rather
 * than guessed at. A wrong allow-list silently refusing every request is a worse failure
 * than an absent one, and this server serves public markdown either way, so the absence
 * is reported on startup rather than papered over with a default list.
 *
 * @returns {string[]}
 */
export function allowedHosts() {
  const raw = process.env.MCP_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

/**
 * Build the HTTP application.
 *
 * @param {{ inFlight?: Set<() => void>, token?: string }} [options] — `inFlight`, when given,
 *   receives one closer per in-flight `/mcp` request, so the entry point can drain them
 *   deliberately on shutdown rather than dropping them when the process exits. This is what
 *   replaced the SSE session map: the map counted *connections*, which on a stateless
 *   transport is the same thing counted by a different name, and a set of closers is what a
 *   drain can actually act on.
 *
 *   `token` is the bearer token every request but `/healthz` must carry. It defaults to
 *   `MCP_AUTH_TOKEN`, read now. **There is no way to build this app without one**: a missing or
 *   too-short token throws, so an unauthenticated HTTP server cannot come from forgetting an
 *   option. `src/http.js` checks first, in the primary, to report it once instead of once per
 *   worker.
 * @returns {import("express").Express}
 */
export function createApp({ inFlight, token = configuredToken() } = {}) {
  const problem = tokenProblem(token);
  if (problem) {
    throw new Error(`Refusing to build the HTTP app: ${problem}.`);
  }

  const app = express();

  // Express stamps `X-Powered-By: Express` on every response it sends, which hands an
  // unauthenticated caller the framework and the exact version serving the port — a free
  // upgrade suggestion, and a narrowing of what an attacker has to guess. The header is
  // removed here deliberately and this line is a security control, not an omission: do
  // not restore it because a route looks like it is missing a header.
  //
  // `disable` rather than `app.set` because this is a setting of the app itself and it
  // must hold for every response, including the ones no route here produces. It sits
  // above the middleware below because it configures the app rather than joining the
  // request chain.
  app.disable("x-powered-by");

  // Ahead of the body parser and ahead of every route, `/healthz` included: an
  // allow-list that guards `/mcp` and not `/healthz` is an allow-list with a hole in
  // it, and a deployment watching a green health check on a service nothing can reach
  // is worse than no check at all.
  //
  // The SDK applies host validation automatically only through its own Express app
  // factory, and only when the host is loopback. This server binds `0.0.0.0` by
  // default, so without an explicit list there is no `Host` filtering in exactly the
  // deployment — a container, a shared host — where it would matter. This is carried
  // forward from the SSE implementation unchanged, including that reasoning.
  const hosts = allowedHosts();
  if (hosts.length > 0) {
    app.use(hostHeaderValidation(hosts));
  }

  // The token check, after the `Host` allow-list and ahead of the body parser and every route.
  // Ahead of the parser, so a caller without the token cannot make this server read and parse
  // up to 4 MB; ahead of the routes, so it cannot find out which exist — the 404 and the 405
  // are answers about routes, and they are only given to a caller who may ask.
  //
  // `GET /healthz` is the one exemption, and it is exact: the method and the path, nothing that
  // merely starts with it. An orchestrator's probe cannot send a token, and the route returns
  // only `{ status, server, version }`. The exemption is never looser than the route: express
  // would also match `/healthz/` and `HEAD`, and those fall through to the check and are
  // refused, which is the safe direction to be wrong in.
  const authenticate = requireBearerToken(token);
  app.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/healthz") {
      next();
      return;
    }
    authenticate(req, res, next);
  });

  app.use(express.json({ limit: BODY_LIMIT_BYTES }));

  /**
   * The health check. Answers without a request body, a session, or a tool.
   *
   * **New for this repository, and it is a real change of position** — see
   * `wiki/reference/mcp-surface.md`, which previously argued that no probe endpoint
   * should exist. The four sibling servers in the organization already serve `/healthz`,
   * and consistency across them is why this one does too. The objection was about a
   * route that exists to be scanned; a route that exists so a container orchestrator
   * can tell a serving process from a wedged one is a different thing, and `/healthz`
   * answers before any body is read, so it exposes nothing the set does not.
   */
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", server: SERVER_NAME, version: VERSION });
  });

  /**
   * The MCP endpoint.
   *
   * Stateless: a fresh `McpServer` and a fresh transport per request, with
   * `sessionIdGenerator: undefined` telling the transport not to mint a session id.
   * **There is no session store, and there is nothing replacing it** — the map keyed by
   * connection id was the state that made SSE stateful, and a transport that holds no
   * state between requests has nothing to key.
   */
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Fires on disconnect as well as on a clean close, which is the case that leaks.
    // Closing both halves is what keeps a stateless transport stateless: a retained
    // McpServer per request would be a leak per request.
    const finish = () => {
      if (inFlight) inFlight.delete(finish);
      void transport.close();
      void server.close();
    };
    if (inFlight) inFlight.add(finish);
    res.on("close", finish);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) rpcError(res, 500, -32603, String(error));
    }
  });

  // Any other method on `/mcp` is refused rather than served. It is a refusal and not a
  // 404: the path exists, and saying so is more useful to a client than pretending it
  // does not. A stateless server cannot accept the GET side of the Streamable HTTP
  // protocol either, and the message says which of the two it is.
  app.all("/mcp", (req, res) => {
    rpcError(res, 405, -32000, `${req.method} is not supported in stateless mode`);
  });

  // Anything else is not a route this server has. A 404 that says so is more useful than
  // a bare one, and it is the only place a request is answered with prose. The old catch-
  // all here pointed a caller at the two routes this transport replaces; those are gone,
  // so that sentence is deleted rather than edited into a longer one naming a route that no
  // longer exists.
  app.use((req, res) => {
    rpcError(res, 404, -32601, `Not found: ${req.originalUrl}`);
  });

  /**
   * Errors the routes above did not answer.
   *
   * `express.json` reports an oversized body as `entity.too.large` and a malformed one as
   * `entity.parse.failed`. **Both become the same 400 / `-32700`**, because a client
   * that sent something unreadable gets one answer whichever way it was wrong, and two
   * error codes for one cause is a distinction no client needs.
   *
   * Registered last, and declared with four arguments, because that is how express
   * recognises an error handler rather than ordinary middleware.
   */
  app.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error?.type === "entity.too.large" || error?.type === "entity.parse.failed") {
      rpcError(res, 400, -32700, "Parse error: request body is not valid JSON");
      return;
    }

    rpcError(res, 500, -32603, String(error?.message ?? error));
  });

  return app;
}
