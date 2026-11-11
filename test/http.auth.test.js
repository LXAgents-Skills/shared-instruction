import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LOOPBACK_HOSTNAMES, createApp } from "../src/app.js";
import {
  MIN_TOKEN_LENGTH,
  configuredToken,
  isLoopbackHost,
  startupTokenProblem,
  tokenProblem,
} from "../src/auth.js";
import {
  EXPECTED_TOOLS,
  ROOT,
  ENTRY_INDEX,
  TEST_TOKEN,
  bearer,
  withServer,
  connect,
  openClients,
  requestWithHost,
  LIST_TOOLS,
  withHeaders,
  runToExit,
} from "./helpers/http-harness.js";

/**
 * The HTTP transport over a real socket: authentication.
 *
 * Shared setup is in `helpers/http-harness.js`.
 */

test("a request with no token is refused with a 401 the client can read", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, LIST_TOOLS);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="mcp"');
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, null);
    assert.equal(body.error.code, -32001);
    assert.match(body.error.message, /send the token as Authorization: Bearer/);
  });
});

test("a wrong token is refused, whatever its length, and never with a 500", async () => {
  await withServer({}, async ({ url }) => {
    const wrong = [
      TEST_TOKEN.slice(0, -1) + (TEST_TOKEN.endsWith("f") ? "e" : "f"), // one character off
      TEST_TOKEN.slice(0, -1), // a prefix of the real one
      TEST_TOKEN + "0", // the real one with something after it
      TEST_TOKEN.toUpperCase(),
      "x",
      "x".repeat(10_000),
    ];

    for (const token of wrong) {
      const response = await fetch(`${url}/mcp`, withHeaders(bearer(token)));
      const body = await response.json();

      assert.equal(response.status, 401, `a ${token.length}-character token must be refused`);
      assert.equal(
        response.headers.get("www-authenticate"),
        'Bearer realm="mcp", error="invalid_token"'
      );
      assert.match(body.error.message, /the token is not valid/);
    }
  });
});

test("only a bearer credential counts, and the scheme is case-insensitive", async () => {
  await withServer({}, async ({ url }) => {
    const refused = [
      `Basic ${TEST_TOKEN}`,
      "Bearer",
      "Bearer ",
      `Bearer ${TEST_TOKEN} ${TEST_TOKEN}`,
      TEST_TOKEN,
    ];
    for (const authorization of refused) {
      const response = await fetch(`${url}/mcp`, withHeaders({ authorization }));
      assert.equal(response.status, 401, `"${authorization.slice(0, 12)}…" must be refused`);
    }

    const accepted = await fetch(`${url}/mcp`, withHeaders({ authorization: `bearer ${TEST_TOKEN}` }));
    assert.equal(accepted.status, 200, "RFC 7235 says the scheme is case-insensitive");
  });
});

test("the right token is served", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, withHeaders(bearer()));

    assert.equal(response.status, 200);
    assert.match(await response.text(), /automation/);
  });
});

test("an unauthenticated caller learns nothing about which routes exist", async () => {
  // A 404 and a 405 are answers about routes. Given to a caller without the token they would
  // map the server for free, so every guarded route answers the same 401.
  await withServer({}, async ({ url }) => {
    const probes = [
      ["GET", "/mcp"],
      ["DELETE", "/mcp"],
      ["POST", "/nope"],
      ["GET", "/sse"],
      ["POST", "/message"],
    ];

    for (const [method, path] of probes) {
      const response = await fetch(`${url}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path} must be refused, not routed`);
    }
  });
});

test("the token is checked before the body is read", async () => {
  // A malformed body is a 400 once it is parsed. Without the token it is never parsed, so the
  // answer is 401 — an unauthenticated caller cannot make this server read and parse a body.
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not json",
    });

    assert.equal(response.status, 401);
  });
});

test("only GET /healthz is open, and the exemption is exact", async () => {
  await withServer({}, async ({ url }) => {
    assert.equal((await fetch(`${url}/healthz`)).status, 200, "the probe needs no token");
    assert.equal(
      (await fetch(`${url}/healthz`, { headers: bearer("wrong") })).status,
      200,
      "and a wrong token on it is not an error"
    );

    // Nothing that merely resembles the route inherits the exemption.
    assert.equal((await fetch(`${url}/healthz`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${url}/healthz`, { method: "HEAD" })).status, 401);
    assert.equal((await fetch(`${url}/healthz/x`)).status, 401);
    assert.equal((await fetch(`${url}/healthzz`)).status, 401);
  });
});

test("the allow-list still runs before the token check", async () => {
  // A disallowed Host is refused as a Host problem, not answered with a 401 that invites the
  // caller to try a token against a name this server was told not to answer to.
  await withServer(
    { env: { MCP_ALLOWED_HOSTS: "shared-instruction.example.test" } },
    async ({ url }) => {
      assert.equal((await requestWithHost({ url, host: "evil.test", path: "/mcp" })).status, 403);
    }
  );
});

test("the startup line says a token is required, and no log line ever carries one", async () => {
  await withServer({}, async ({ url, output, waitForOutput }) => {
    // Each worker writes this line just after its startup line, and readiness waits only for the
    // startup line, so the line is waited for rather than read at once.
    await waitForOutput("bearer token required on every route except GET /healthz");
    assert.match(output(), /bearer token required on every route except GET \/healthz/);

    const attempt = "wrong-token-that-must-not-be-logged-0123456789";
    await fetch(`${url}/mcp`, withHeaders(bearer(attempt)));
    await fetch(`${url}/mcp`, withHeaders(bearer()));

    assert.ok(!output().includes(TEST_TOKEN), "the real token must not be logged");
    assert.ok(!output().includes(attempt), "a rejected token must not be logged");
  });
});

test("a token with a trailing newline, as an env file leaves it, still matches", async () => {
  await withServer({ env: { MCP_AUTH_TOKEN: `${TEST_TOKEN}\n` } }, async ({ url }) => {
    const client = await connect(url);
    openClients.add(client);
    try {
      assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS);
    } finally {
      await client.close();
      openClients.delete(client);
    }
  });
});

test("a token of exactly the minimum length is accepted", async () => {
  const token = "k".repeat(MIN_TOKEN_LENGTH);

  await withServer({ env: { MCP_AUTH_TOKEN: token } }, async ({ url }) => {
    assert.equal((await fetch(`${url}/mcp`, withHeaders(bearer(token)))).status, 200);
  });
});

test("HTTP off loopback refuses to start without a usable token", async () => {
  const cases = [
    ["unset", "", /MCP_AUTH_TOKEN is not set/],
    ["only whitespace", "  \n ", /MCP_AUTH_TOKEN is not set/],
    ["too short", "short-secret", /MCP_AUTH_TOKEN is 12 characters, and it must be at least 32/],
    [
      "one character short",
      "k".repeat(MIN_TOKEN_LENGTH - 1),
      new RegExp(`is ${MIN_TOKEN_LENGTH - 1} characters`),
    ],
  ];

  for (const [name, token, message] of cases) {
    // Every interface, the default and the server case. Refused before anything binds.
    const { code, output } = await runToExit({ env: { HOST: "0.0.0.0", MCP_AUTH_TOKEN: token } });

    assert.equal(code, 1, `${name}: it must exit 1, got ${code}\n${output}`);
    assert.match(output, message, name);
    assert.match(output, /openssl rand -hex 32/, `${name}: the message must say how to fix it`);
    assert.doesNotMatch(output, /serving Skill MCP over http/, `${name}: it must not have bound the port`);
    if (token.trim()) assert.ok(!output.includes(token), `${name}: the value must not be echoed`);
  }
});

test("the refusal to start is the same through src/index.js, and printed once however many workers", async () => {
  for (const env of [
    { MCP_TRANSPORT: "http", HOST: "0.0.0.0", MCP_AUTH_TOKEN: "" },
    { MCP_TRANSPORT: "http", HOST: "0.0.0.0", MCP_AUTH_TOKEN: "", MCP_CLUSTER_WORKERS: "3" },
  ]) {
    const { code, output } = await runToExit({ entry: ENTRY_INDEX, env });

    assert.equal(code, 1, output);
    assert.equal(output.split("will not start the HTTP transport").length - 1, 1, output);
    assert.doesNotMatch(output, /forking \d+ HTTP workers/);
    assert.doesNotMatch(output, /worker \d+ exited/, "a missing token must not become a respawn loop");
  }
});

test("HTTP on loopback starts without a token, and says so", async () => {
  await withServer({ env: { MCP_AUTH_TOKEN: "" } }, async ({ url, output, waitForOutput }) => {
    // No Authorization header at all, and the request is served.
    const response = await fetch(`${url}/mcp`, LIST_TOOLS);
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(`"tools"`));

    await waitForOutput("no bearer token");
    assert.match(output(), /no bearer token: 127\.0\.0\.1 is loopback, so only this machine can connect/);
    assert.doesNotMatch(output(), /bearer token required/);
  });
});

test("a token-less local server still checks the Host header", async () => {
  // DNS rebinding: a page in this machine's browser can reach 127.0.0.1 under its own domain.
  // With no token, the Host check is what refuses it.
  await withServer({ env: { MCP_AUTH_TOKEN: "" } }, async ({ url, output, waitForOutput }) => {
    assert.equal((await requestWithHost({ url, host: "evil.example", path: "/mcp" })).status, 403);
    assert.equal((await requestWithHost({ url, host: "localhost" })).status, 200);

    await waitForOutput("so the Host header must be one of");
    assert.match(output(), new RegExp(`must be one of ${LOOPBACK_HOSTNAMES.join(", ").replace(/[[\]]/g, "\\$&")}`));
    assert.doesNotMatch(output(), /no Host header allow-list is applied/);
  });
});

test("a token set on loopback is still enforced, and still has to be usable", async () => {
  await withServer({}, async ({ url }) => {
    assert.equal((await fetch(`${url}/mcp`, LIST_TOOLS)).status, 401);
  });

  const { code, output } = await runToExit({ env: { MCP_AUTH_TOKEN: "short-secret" } });
  assert.equal(code, 1, output);
  assert.match(output, /will not start the HTTP transport on 127\.0\.0\.1: MCP_AUTH_TOKEN is 12 characters/);
});

test("isLoopbackHost and startupTokenProblem", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["0.0.0.0", "::", "", "10.0.0.1", "example.com", "127.0.0.1.example.com", "128.0.0.1"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }

  assert.equal(startupTokenProblem("127.0.0.1", ""), null);
  assert.match(startupTokenProblem("127.0.0.1", "short"), /must be at least 32/);
  assert.equal(startupTokenProblem("127.0.0.1", TEST_TOKEN), null);
  assert.equal(startupTokenProblem("0.0.0.0", ""), "MCP_AUTH_TOKEN is not set");
  assert.equal(startupTokenProblem("0.0.0.0", TEST_TOKEN), null);
});

test("createApp cannot be built without a usable token", () => {
  const saved = process.env.MCP_AUTH_TOKEN;
  try {
    delete process.env.MCP_AUTH_TOKEN;
    assert.throws(() => createApp(), /Refusing to build the HTTP app: MCP_AUTH_TOKEN is not set/);
    assert.throws(() => createApp({ token: "short" }), /must be at least 32/);
    assert.throws(() => createApp({ token: "" }), /is not set/);

    // The open form needs the explicit option, and never applies to a token that was given.
    assert.equal(typeof createApp({ requireToken: false }).listen, "function");
    assert.throws(() => createApp({ requireToken: false, token: "short" }), /must be at least 32/);

    process.env.MCP_AUTH_TOKEN = TEST_TOKEN;
    assert.equal(typeof createApp().listen, "function", "the environment supplies the default");
    assert.equal(typeof createApp({ token: "z".repeat(40) }).listen, "function");
  } finally {
    if (saved === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = saved;
  }
});

test("tokenProblem and configuredToken", () => {
  assert.equal(tokenProblem(""), "MCP_AUTH_TOKEN is not set");
  assert.match(tokenProblem("k".repeat(31)), /is 31 characters, and it must be at least 32/);
  assert.equal(tokenProblem("k".repeat(32)), null);
  assert.equal(tokenProblem(TEST_TOKEN), null);

  const saved = process.env.MCP_AUTH_TOKEN;
  try {
    process.env.MCP_AUTH_TOKEN = `  ${TEST_TOKEN}\r\n`;
    assert.equal(configuredToken(), TEST_TOKEN);
    delete process.env.MCP_AUTH_TOKEN;
    assert.equal(configuredToken(), "");
  } finally {
    if (saved === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = saved;
  }
});

test("stdio never reads the token, so even an unusable one does not stop it", async () => {
  const client = new Client({ name: "stdio-token-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"],
    cwd: ROOT,
    // Too short to start HTTP with. If stdio read the variable at all, this would fail it.
    env: { ...process.env, MCP_TRANSPORT: "stdio", MCP_AUTH_TOKEN: "x" },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS);
  } finally {
    await client.close();
  }
});
