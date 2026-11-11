import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { rpcError } from "./rpc-error.js";

/**
 * Bearer-token authentication for the HTTP transport.
 *
 * **Where the server can be reached decides whether a token is needed.** stdio is a pipe that a
 * client spawns on its own machine, so whoever can use it already runs the process and there is
 * nobody to authenticate. HTTP bound to a loopback address is the same local install over a
 * socket: only this machine can open it, so a token is optional there. HTTP bound to any other
 * address is a server that anyone who can reach the port can open, so every request must prove
 * the caller holds the token — and the server refuses to run without one, rather than running
 * open and saying so in a log nobody reads.
 *
 * Nothing in this file is reached by the stdio entry point, and `src/index.ts` never reads
 * `MCP_AUTH_TOKEN` on that path.
 */

/**
 * The shortest token the server will accept, in characters.
 *
 * The token is the only thing standing between a network and this server, so a value like
 * `test` is refused at startup instead of being discovered by a scanner. 32 characters is what
 * `openssl rand -hex 16` produces at the very least, and the documented command produces 64.
 */
export const MIN_TOKEN_LENGTH = 32;

/**
 * Whether `host` is a loopback address, so that a socket bound to it is reachable only from
 * this machine: `localhost`, any `127.x.x.x`, or `::1` (bracketed or not).
 *
 * `0.0.0.0` and `::` are not loopback — they bind every interface — and neither is a hostname
 * that merely resolves to loopback today, because that can change without this process knowing.
 *
 */
export function isLoopbackHost(host: string | undefined): boolean {
  const value = String(host ?? "").trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return value === "localhost" || value === "::1" || /^127(\.\d{1,3}){3}$/.test(value);
}

/**
 * Why HTTP bound to `host` cannot start with `token`, or `null` when it can.
 *
 * Off loopback a usable token is required. On loopback none is needed, but a token that was set
 * is still checked: setting one is asking for it, and quietly running open instead would be a
 * downgrade nobody chose.
 *
 */
export function startupTokenProblem(host: string, token: string = configuredToken()): string | null {
  if (token === "" && isLoopbackHost(host)) return null;
  return tokenProblem(token);
}

/**
 * The configured token, or an empty string when there is none.
 *
 * Read at call time and never at import: a value captured when the module loaded is whatever
 * happened to be set then, which breaks a process that sets it later and any test that sets and
 * unsets it. Surrounding whitespace is dropped, because a token copied out of a file or an
 * `env_file` often carries a trailing newline and an HTTP header cannot.
 *
 */
export function configuredToken(): string {
  return (process.env.MCP_AUTH_TOKEN ?? "").trim();
}

/**
 * Why `token` cannot be used, or `null` when it can.
 *
 * The message names the variable and the fix and never the value, so it is safe to log.
 *
 */
export function tokenProblem(token: string = configuredToken()): string | null {
  if (token === "") return "MCP_AUTH_TOKEN is not set";
  if (token.length < MIN_TOKEN_LENGTH) {
    return `MCP_AUTH_TOKEN is ${token.length} characters, and it must be at least ${MIN_TOKEN_LENGTH}`;
  }
  return null;
}

/** SHA-256 of a string, so two values of any length compare in constant time. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The credential in an `Authorization: Bearer <credential>` header, or `null`.
 *
 * The scheme is case-insensitive (RFC 7235). Anything else — another scheme, no credential, two
 * of them — is not a bearer credential. The pattern is linear: the space run and the credential
 * are disjoint character classes.
 *
 */
function bearerCredential(header: string | undefined): string | null {
  const match = /^Bearer +(\S+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/**
 * Express middleware that lets a request through only when it carries `token`.
 *
 * A refusal is a `401` in the JSON-RPC error envelope every other refusal on this server uses,
 * with `WWW-Authenticate: Bearer`. A request that sent a credential which did not match also
 * gets `error="invalid_token"`, so a client can tell a missing header from a wrong one. Neither
 * answer reveals anything about the token itself.
 *
 * The comparison is constant-time over fixed-length digests, so neither the token's length nor
 * how much of it a guess got right shows in how long the answer takes.
 *
 * @param token A token that already passed `tokenProblem`.
 */
export function requireBearerToken(token: string): RequestHandler {
  const expected = digest(token);

  return (req, res, next) => {
    const credential = bearerCredential(req.get("authorization"));

    if (credential !== null && timingSafeEqual(digest(credential), expected)) {
      next();
      return;
    }

    const challenge =
      credential === null ? 'Bearer realm="mcp"' : 'Bearer realm="mcp", error="invalid_token"';
    res.set("WWW-Authenticate", challenge);
    rpcError(
      res,
      401,
      -32001,
      credential === null
        ? "Unauthorized: send the token as Authorization: Bearer <token>"
        : "Unauthorized: the token is not valid",
    );
  };
}
