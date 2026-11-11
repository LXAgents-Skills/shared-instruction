import type { Response } from "express";

/**
 * A JSON-RPC error response.
 *
 * The one shape every refusal on this server uses — the routes, the error handler, and the
 * bearer-token check. It is the same envelope a client parses for a successful response, so a
 * client never has to branch on content type to find out it was refused.
 *
 * @param status The HTTP status.
 * @param code The JSON-RPC error code.
 */
export function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}
