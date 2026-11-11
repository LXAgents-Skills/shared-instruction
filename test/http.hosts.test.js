import assert from "node:assert/strict";
import test from "node:test";
import {
  withServer,
  requestWithHost,
} from "./helpers/http-harness.js";

/**
 * The HTTP transport over a real socket: the `Host` allow-list.
 *
 * Shared setup is in `helpers/http-harness.js`.
 */

test("with no allow-list set, nothing is refused", async () => {
  await withServer({}, async ({ url }) => {
    // The default, and the one the plan calls the safe-looking-unsafe one. It is asserted
    // explicitly so that a future change to refuse-by-default has to contradict a test
    // rather than pass quietly.
    for (const host of ["example.test", "evil.test", "127.0.0.1"]) {
      const { status } = await requestWithHost({ url, host });
      assert.equal(status, 200, `${host} must be served when no allow-list is set`);
    }
  });
});

test("the startup line announces that no allow-list is applied", async () => {
  await withServer({}, async ({ output }) => {
    assert.match(output(), /MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied/);
  });
});

test("the allow-list is applied when MCP_ALLOWED_HOSTS is set", async () => {
  const allowed = "shared-instruction.example.test, other.example.test";

  await withServer({ env: { MCP_ALLOWED_HOSTS: allowed } }, async ({ url, port, proc }) => {
    assert.equal(
      (await requestWithHost({ url, host: "shared-instruction.example.test" })).status,
      200
    );
    assert.equal(
      (await requestWithHost({ url, host: "other.example.test" })).status,
      200
    );

    // The refusal, and its shape: a 403 carrying a JSON-RPC error, not a 404 and not a
    // dropped connection.
    const refused = await requestWithHost({ url, host: "evil.test" });
    assert.equal(refused.status, 403);
    assert.match(JSON.parse(refused.body).error.message, /Invalid Host: evil\.test/);

    // The port is not part of the match. A client that reaches the server through a proxy
    // sends `host:port`, and an allow-list that matched the whole header would refuse it
    // while looking correct in a test that used the bare name.
    assert.equal(
      (await requestWithHost({ url, host: `shared-instruction.example.test:${port}` })).status,
      200
    );

    assert.equal(proc.exitCode, null, "the server is still running");
  });
});

test("the allow-list guards the health check too", async () => {
  // Otherwise a deployment could watch its own server through /healthz while every real
  // caller was refused — a green check on a service nothing can reach.
  await withServer(
    { env: { MCP_ALLOWED_HOSTS: "shared-instruction.example.test" } },
    async ({ url }) => {
      assert.equal((await requestWithHost({ url, host: "evil.test" })).status, 403);
      assert.equal(
        (await requestWithHost({ url, host: "shared-instruction.example.test" })).status,
        200
      );
    }
  );
});

test("setting MCP_ALLOWED_HOSTS silences the warning, so neither can pass by accident", async () => {
  await withServer(
    { env: { MCP_ALLOWED_HOSTS: "shared-instruction.example.test" } },
    async ({ output }) => {
      assert.doesNotMatch(output(), /MCP_ALLOWED_HOSTS is unset/);
      assert.doesNotMatch(output(), /no Host header allow-list is applied/);
    }
  );
});

test("an allow-list of nothing but separators still counts as unset", async () => {
  // `MCP_ALLOWED_HOSTS=` is a shell that lost the value, and `MCP_ALLOWED_HOSTS= , ,` is a
  // paste that did. Treating either as "allow nothing" would refuse every request with a
  // message that names no host at all.
  await withServer({ env: { MCP_ALLOWED_HOSTS: " , , " } }, async ({ url, output }) => {
    assert.equal((await requestWithHost({ url, host: "anything.test" })).status, 200);
    assert.match(output(), /MCP_ALLOWED_HOSTS is unset/);
  });
});
