import assert from "node:assert/strict";
import test from "node:test";
import { BODY_LIMIT_BYTES } from "../src/app.js";
import {
  bearer,
  withServer,
} from "./helpers/http-harness.js";

/**
 * The HTTP transport over a real socket: the body limit, parse errors, and the headers a response must not carry.
 *
 * Shared setup is in `helpers/http-harness.js`.
 */

test("the body limit is the 4 MB it is declared to be", () => {
  // Pinned as a number, not just as a relation to whatever the constant now says. A limit
  // that quietly became 64 MB would keep every boundary test in this file passing, and the
  // number is a documented property of the transport rather than an implementation detail.
  assert.equal(BODY_LIMIT_BYTES, 4 * 1024 * 1024);
});

test("a body over the limit is refused, and says so in the JSON-RPC envelope", async () => {
  await withServer({}, async ({ url }) => {
    // Valid JSON, valid MCP, simply too large: the only thing wrong with it is its size, so
    // a refusal here is the limit and not a parse failure.
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "branching_strategy",
        arguments: {},
        padding: "x".repeat(BODY_LIMIT_BYTES),
      },
    });
    assert.ok(oversized.length > BODY_LIMIT_BYTES, "the payload must actually exceed the limit");

    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer() },
      body: oversized,
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.error.code, -32700);
  });
});

test("malformed JSON is refused with exactly the same answer as a body that is too large", async () => {
  // One answer for two causes. A client that sent something unreadable gets the same status
  // and the same code whichever way it was wrong, and splitting them would be a behaviour
  // change nobody asked for.
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer() },
      body: "{ this is not json",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32700);
    assert.equal(body.error.message, "Parse error: request body is not valid JSON");
  });
});

test("no response advertises that the server is running express", async () => {
  await withServer({}, async ({ url }) => {
    // Checked on a served route, on the catch-all, and on the 405, because those three are
    // produced by different places in the stack and could plausibly have taken different
    // paths through it. `X-Powered-By` hands an unauthenticated caller the framework and
    // its version, which is a free upgrade suggestion.
    const health = await fetch(`${url}/healthz`);
    const missing = await fetch(`${url}/nope`, { headers: bearer() });
    const refused = await fetch(`${url}/mcp`, { headers: bearer() });
    // And on the 401, which is produced by this repository's own middleware rather than by a
    // route, so it is the answer most likely to have been built without going through `app`.
    const unauthorized = await fetch(`${url}/mcp`);

    for (const response of [health, missing, refused, unauthorized]) {
      assert.equal(
        response.headers.get("x-powered-by"),
        null,
        `X-Powered-By leaked on ${response.url}`
      );
    }
  });
});
