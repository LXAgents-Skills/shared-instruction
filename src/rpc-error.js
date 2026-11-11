/**
 * A JSON-RPC error response.
 *
 * The one shape every refusal on this server uses — the routes, the error handler, and the
 * bearer-token check. It is the same envelope a client parses for a successful response, so a
 * client never has to branch on content type to find out it was refused.
 *
 * @param {import("express").Response} res
 * @param {number} status The HTTP status.
 * @param {number} code The JSON-RPC error code.
 * @param {string} message
 */
export function rpcError(res, status, code, message) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}
