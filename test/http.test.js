import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BODY_LIMIT_BYTES, createApp } from "../src/app.js";
import { MIN_TOKEN_LENGTH, configuredToken, tokenProblem } from "../src/auth.js";
import { createServer, INSTRUCTION_MODULES } from "../src/server.js";
import { SERVER_NAME } from "../src/version.js";

/**
 * How many tools a correctly built surface has.
 *
 * Derived from the same array `createServer()` registers from, so adding a file to
 * `content/` does not mean editing four hardcoded numbers in this file. Every tool is
 * generated from a file, so it equals `INSTRUCTION_FILES.size`, which is the count
 * `server.test.js` asserts against.
 *
 * **The lower bound is the point.** A count derived from the thing under test passes
 * when the thing under test is empty, so this asserts the surface is real before using
 * its size as an expectation. Without it, a `content/` that failed to load would make
 * every assertion below pass by comparing zero to zero.
 */
const EXPECTED_TOOLS = INSTRUCTION_MODULES.length;
assert.ok(
  EXPECTED_TOOLS > 20,
  `expected a real tool surface, found ${EXPECTED_TOOLS} — content/ may have failed to load`,
);

/**
 * The HTTP transport, tested over a real socket.
 *
 * `test/server.test.js` exercises the server in memory: same code, no listener. What that
 * cannot reach is the part that only exists when there is a socket — the route table, the
 * transport's own framing, the host it binds, the shape of its errors, and what a shutdown
 * does to a request that is still in flight. This file is that half, and it starts the real
 * entry point as a real child process rather than importing it, because an imported module
 * cannot be given a second port or stopped.
 *
 * It is a rewrite rather than an edit. Every test that opened an SSE stream, minted a
 * session id, or asserted on the session store died with the transport it was testing, and
 * a test edited into shape tests the new code with the old code's assumptions.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The two entry points, named rather than assumed.
 *
 * `src/http.js` is what `npm run start:http` and the `Dockerfile` run, and most of this
 * file drives it. `src/index.js` is what a client spawns, and the delegation to
 * `src/http.js` on `MCP_TRANSPORT=http` is a separate behaviour with its own test — a
 * change that made `npm run start:http` work and `MCP_TRANSPORT=http` fail would be the
 * kind of near miss that reads as a working server.
 */
const ENTRY_HTTP = join(ROOT, "src", "http.js");
const ENTRY_INDEX = join(ROOT, "src", "index.js");

/**
 * The token every server started by this file runs with, unless a test says otherwise.
 *
 * The HTTP transport will not start without one, and refuses every request that does not carry
 * it. Defaulting it in `startServer` keeps the tests that are about something else — the
 * workers, the body limit, the allow-list — about that thing rather than about authentication.
 * Long enough to pass the length check, and obviously not a real secret.
 */
const TEST_TOKEN = "test-token-0123456789abcdef0123456789abcdef";

/** An `Authorization` header carrying `token`. */
const bearer = (token = TEST_TOKEN) => ({ authorization: `Bearer ${token}` });

/**
 * How long to wait for the startup line.
 *
 * A deadline rather than a sleep, so the common case costs nothing: the server is up in well
 * under a second on a normal filesystem. It is generous because a checkout on a network or
 * 9p mount can take several seconds just to load the SDK, and a deadline that is too short
 * fails a working server for an environmental reason.
 */
const READY_TIMEOUT_MS = 30_000;

/** The text of a single-content tool result. */
function textOf(result) {
  assert.notEqual(result.isError, true, "expected a successful result");
  assert.equal(result.content.length, 1, "expected exactly one content block");
  return result.content[0].text;
}

/** A free port, so parallel runs do not collide. */
function freePort() {
  // Bound and immediately released. Still correct now that N workers race for the one port:
  // they race for it through the cluster's shared handle, so exactly one `bind` syscall
  // happens however many of them there are, and a helper that probed the port with one
  // process would be no more wrong than a helper that probed it with N. The window between
  // the release and the child's bind is small and it is the window any free-port helper has.
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Every child started by this file, so a failed assertion cannot leak one. */
const openServers = new Set();

after(() => {
  for (const child of openServers) child.kill("SIGKILL");
});

/**
 * Start a server and wait until it is listening.
 *
 * Both streams are captured, because the startup line is on stderr and stdout must stay
 * empty on a server process — a line on stdout would be a defect worth failing on, and one
 * that only shows up when someone switches back to stdio.
 *
 * @param {{ entry?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<{child: import("node:child_process").ChildProcess, port: number,
 *   url: string, proc: import("node:child_process").ChildProcess,
 *   output: () => string, stdout: () => string, stderr: () => string,
 *   countOutput: (needle: string) => number, waitForOutput: (needle: string, ms?: number) => Promise<boolean>}>}
 */
async function startServer({ entry = ENTRY_HTTP, env = {} } = {}) {
  const port = await freePort();

  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      // Bound to loopback on purpose: this file must never open a port on every interface
      // of whatever machine runs the suite.
      HOST: "127.0.0.1",
      MCP_AUTH_TOKEN: TEST_TOKEN,
      ...env,
    },
  });

  openServers.add(child);
  child.on("exit", () => openServers.delete(child));

  let captured = "";
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    captured += chunk;
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    captured += chunk;
    stderr += chunk;
  });

  /** Everything the process has written, on either stream. */
  const output = () => captured;

  /**
   * How many times `needle` has appeared so far.
   *
   * Not a boolean: with more than one worker the line is printed once per worker, and "the
   * line appeared" cannot tell one process from two.
   */
  const countOutput = (needle) => captured.split(needle).length - 1;

  /** Resolve true once `needle` has appeared, false if `ms` runs out first. */
  const waitForOutput = (needle, ms = READY_TIMEOUT_MS) =>
    new Promise((resolveWait) => {
      if (captured.includes(needle)) {
        resolveWait(true);
        return;
      }
      const deadline = Date.now() + ms;
      const poll = setInterval(() => {
        if (captured.includes(needle)) {
          clearInterval(poll);
          resolveWait(true);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          resolveWait(false);
        }
      }, 50);
    });

  /** Resolve true once `needle` has appeared `n` times, false if `ms` runs out first. */
  const waitForCount = (needle, n, ms = READY_TIMEOUT_MS) =>
    new Promise((resolveWait) => {
      if (countOutput(needle) >= n) {
        resolveWait(true);
        return;
      }
      const deadline = Date.now() + ms;
      const poll = setInterval(() => {
        if (countOutput(needle) >= n) {
          clearInterval(poll);
          resolveWait(true);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          resolveWait(false);
        }
      }, 50);
    });

  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  // Either the startup line arrives, or the process dies trying — whichever comes first.
  // A server that exited quietly is a failure to report with its own output attached, not
  // a server to test against.
  const ready = await Promise.race([
    waitForOutput("serving over http").then((ok) => ({ ok })),
    exited.then((exit) => ({ exit })),
  ]);

  if (ready.exit || !ready.ok) {
    const how = ready.exit
      ? `it exited with code ${ready.exit.code} and signal ${ready.exit.signal}`
      : `it printed no startup line within ${READY_TIMEOUT_MS}ms`;
    throw new Error(`the server never came up: ${how}.\n--- output ---\n${captured}`);
  }

  return {
    child,
    proc: child,
    port,
    url: `http://127.0.0.1:${port}`,
    output,
    countOutput,
    stdout: () => stdout,
    stderr: () => stderr,
    waitForOutput,
    waitForCount,
  };
}

/**
 * Start a server, hand it to `run`, and stop it afterwards whether or not `run` throws.
 *
 * @param {object} options
 * @param {(server: Awaited<ReturnType<typeof startServer>>) => Promise<void>} run
 */
async function withServer(options, run) {
  const server = await startServer(options);
  try {
    return await run(server);
  } finally {
    server.child.kill("SIGKILL");
  }
}

/** Connect an MCP client to a running server over a real socket, carrying the test token. */
async function connect(url, { token = TEST_TOKEN } = {}) {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: bearer(token) },
    })
  );
  return client;
}

/**
 * Every client opened by these tests.
 *
 * A Streamable HTTP client can hold a socket open, and a client that is never closed keeps
 * the test file's event loop alive — which shows up as a cancelled file rather than a
 * failing test. Tracked so one hook can close them all, including one a test opened before
 * it failed.
 */
const openClients = new Set();

after(async () => {
  await Promise.allSettled([...openClients].map((client) => client.close()));
  openClients.clear();
});

/** An in-memory client, the reference the socket client is compared against. */
async function inMemoryClient() {
  const server = createServer();
  const client = new Client({ name: "in-memory-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("the health check answers without a session", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/healthz`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.server, SERVER_NAME);
    assert.match(body.version, /^\d+\.\d+\.\d+/);
  });
});

test("the startup line names the interface it bound", async () => {
  await withServer({}, async ({ output }) => {
    // The harness binds loopback, so the line has to say loopback. It is the only place the
    // process reports what it actually bound rather than what it was asked to bind, and a
    // container operator reads it first.
    assert.match(output(), /serving over http on :\d+\/mcp \(127\.0\.0\.1\)/);
  });
});

test("a server process writes nothing to stdout", async () => {
  // The rule is repository-wide and used to have an exception: the old HTTP entry point
  // logged its startup line to stdout, which was correct while nothing reached it through
  // `src/index.js`. That exception is gone — the HTTP transport is now reachable from the
  // stdio entry point too, so a process that logs to stdout would be a protocol corruption
  // one line away. Asserted here because it is cheap and a log line drifting onto stdout is
  // a bug that only shows up when someone switches transports.
  await withServer({}, async ({ url, stdout, stderr }) => {
    const client = await connect(url);
    openClients.add(client);

    try {
      await client.listTools();
      textOf(await client.callTool({ name: "branching_strategy", arguments: {} }));
    } finally {
      await client.close();
      openClients.delete(client);
    }

    assert.equal(stdout(), "", `stdout must stay empty, got: ${stdout()}`);
    assert.ok(stderr().length > 0, "the startup line went to stderr");
  });
});

test("the HTTP transport serves the same tools as stdio", async () => {
  await withServer({}, async ({ url }) => {
    const http = await connect(url);
    openClients.add(http);
    const memory = await inMemoryClient();

    try {
      const viaHttp = (await http.listTools()).tools;
      const inMemory = (await memory.client.listTools()).tools;

      assert.equal(viaHttp.length, EXPECTED_TOOLS, "every tool reaches the HTTP transport");
      assert.deepEqual(
        viaHttp.map((tool) => tool.name).sort(),
        inMemory.map((tool) => tool.name).sort()
      );
      assert.deepEqual(
        viaHttp.map((tool) => tool.description).sort(),
        inMemory.map((tool) => tool.description).sort()
      );
    } finally {
      await http.close();
      openClients.delete(http);
      await memory.close();
    }
  });
});

test("no tool advertises an argument over HTTP either", async () => {
  // The read-only claim does not depend on the transport. Over stdio a tool takes no
  // argument; over HTTP it must take none either, or a deployment would have a second door
  // onto whatever a socket opens that a pipe does not.
  await withServer({}, async ({ url }) => {
    const client = await connect(url);
    openClients.add(client);

    try {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        assert.deepEqual(
          tool.inputSchema.properties ?? {},
          {},
          `${tool.name} must take no argument over HTTP`
        );
        assert.deepEqual(tool.inputSchema.required ?? [], []);
      }

      // The property that makes traversal unrepresentable, asserted against the *new*
      // transport rather than the one it replaced: an argument is silently ignored rather
      // than rejected, so what matters is that it cannot change the answer.
      const withArgument = await client.callTool({
        name: "branching_strategy",
        arguments: { path: "../../etc/passwd" },
      });
      assert.equal(
        textOf(withArgument),
        textOf(await client.callTool({ name: "branching_strategy", arguments: {} })),
        "an argument must not change which file is served"
      );
    } finally {
      await client.close();
      openClients.delete(client);
    }
  });
});

test("a tool call over HTTP returns the file byte-identically", async () => {
  await withServer({}, async ({ url }) => {
    const client = await connect(url);
    openClients.add(client);
    const memory = await inMemoryClient();

    try {
      const overHttp = textOf(
        await client.callTool({ name: "branching_strategy", arguments: {} })
      );
      const overMemory = textOf(
        await memory.client.callTool({ name: "branching_strategy", arguments: {} })
      );

      assert.equal(
        overHttp,
        overMemory,
        "one source of truth: the transports must not serve different text"
      );
      assert.match(overHttp, /^---\r?\n/, "frontmatter is part of the served text");
      assert.ok(overHttp.includes("name: branching-strategy"), "frontmatter intact");
    } finally {
      await client.close();
      openClients.delete(client);
      await memory.close();
    }
  });
});

test("an unknown route says what this server does not serve", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/nope`, { headers: bearer() });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.error.code, -32601);
    assert.match(body.error.message, /Not found: \/nope/);

    // The old catch-all ended by pointing the caller at the two routes this transport
    // replaces. Asserted absent rather than merely unreviewed, because a 404 that sends a
    // caller to two routes that no longer exist is worse than a bare one.
    assert.doesNotMatch(JSON.stringify(body), /sse/i);
  });
});

test("GET /mcp is refused rather than served", async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(`${url}/mcp`, { headers: bearer() });
    const body = await response.json();

    assert.equal(response.status, 405);
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /stateless mode/);
  });
});

test("the routes the SSE transport used are gone", async () => {
  // Asserted rather than assumed. A route left behind from the transport this replaces is
  // the failure that looks like a working server: it would still answer, with a protocol
  // whose client side no longer exists, and the symptom would be a deploy that looks
  // healthy right up until a client tries to connect.
  await withServer({}, async ({ url }) => {
    for (const path of ["/sse", "/message"]) {
      const response = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer() },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

      assert.equal(response.status, 404, `${path} must not be served`);
      assert.equal((await response.json()).error.code, -32601);
    }
  });
});

test("concurrent requests do not share state", async () => {
  await withServer({}, async ({ url }) => {
    const tools = ["commit_conventions", "plan_creator", "versioning"];

    // The transport builds a fresh McpServer per request, so three clients answering three
    // different files at once is the assertion that matters. Interleaved calls on one client
    // would pass against a shared server too.
    const clients = await Promise.all([connect(url), connect(url), connect(url)]);
    openClients.add(clients[0]);
    openClients.add(clients[1]);
    openClients.add(clients[2]);

    try {
      const results = await Promise.all(
        clients.map((client, i) => client.callTool({ name: tools[i], arguments: {} }))
      );

      for (const [i, result] of results.entries()) {
        // Tool names are derived from filenames by replacing hyphens with underscores, so the
        // served text carries the hyphenated form. This distinguishes "answered with the right
        // file" from "answered with some file".
        assert.ok(
          textOf(result).includes(`name: ${tools[i].replace(/_/g, "-")}`),
          `${tools[i]} was answered with another request's file`
        );
      }

      // The first client still works after the other two have been talking.
      assert.ok(
        textOf(await clients[0].callTool({ name: "commit_conventions", arguments: {} }))
          .includes("name: commit-conventions")
      );
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      for (const client of clients) openClients.delete(client);
    }
  });
});

test(
  "a shutdown drains and stops accepting, rather than dropping a listener",
  // Windows has no signal delivery: child.kill() terminates the process outright, so a
  // handler cannot be observed there at all. The assertion is about the shutdown path, and
  // pretending it passed on a platform that never ran it would be worse than skipping it.
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer({}, async ({ child, url, output }) => {
      const exited = new Promise((resolveExit) =>
        child.once("exit", (code, signal) => resolveExit({ code, signal }))
      );
      child.kill("SIGINT");

      const { code, signal } = await exited;

      // A handled SIGINT ends in `process.exit(0)`, so the process is gone by its own
      // decision. An unhandled one would report the signal instead, with code null.
      assert.equal(code, 0, `the handler did not run: signal ${signal}`);
      // The count is in-flight *requests*, not sessions. There is no session store left to
      // drain, and a line still reading `session(s)` would describe a transport that is gone.
      assert.match(output(), /SIGINT, draining \d+ in-flight request\(s\)/);

      // And it really is closed: a request after the drain is refused, not queued.
      await assert.rejects(fetch(`${url}/healthz`), "the port is no longer served");
    });
  }
);

/* -------------------------------------------------------------------------- *
 * The `Host` allow-list.
 * -------------------------------------------------------------------------- */

/**
 * A request with a `Host` header of our choosing.
 *
 * `fetch` cannot do this. `Host` is a forbidden header name in the fetch spec, and a client
 * that silently drops it sends the loopback name every time — so a test written with `fetch`
 * would exercise the allow-list and conclude whatever the real control does, which is the
 * worst way to test a security control.
 *
 * @param {{url: string, host: string, path?: string}} options
 * @returns {Promise<{status: number, body: string}>}
 */
function requestWithHost({ url, host, path = "/healthz" }) {
  const target = new URL(path, url);

  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "GET",
        headers: { Host: host },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolveRequest({ status: res.statusCode, body }));
      }
    );

    req.on("error", rejectRequest);
    req.end();
  });
}

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

/* -------------------------------------------------------------------------- *
 * The body limit.
 * -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- *
 * The two entry points.
 * -------------------------------------------------------------------------- */

test("MCP_TRANSPORT=http reaches the same server through src/index.js", async () => {
  // The delegation is a separate behaviour from the server. `package.json`'s `start:http`
  // and the `Dockerfile` both name `src/http.js` and neither may change, so the transport
  // selection lives in `src/index.js` and reaches the entry point by dynamic import. If
  // that hop broke, `npm run start:http` would keep working and every client configured
  // with `MCP_TRANSPORT=http` would silently fall back to stdio.
  await withServer(
    { entry: ENTRY_INDEX, env: { MCP_TRANSPORT: "http" } },
    async ({ url, stdout, output }) => {
      assert.match(output(), /serving over http on :\d+\/mcp/);

      const client = await connect(url);
      openClients.add(client);
      try {
        assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS);
      } finally {
        await client.close();
        openClients.delete(client);
      }

      // And nothing leaked onto stdout on the way through, which is the whole reason the
      // import is dynamic.
      assert.equal(stdout(), "", `stdout must stay empty, got: ${stdout()}`);
    }
  );
});

test("node src/index.js still speaks stdio and writes nothing to stdout", async () => {
  // Not driven through `startServer`, which waits for an HTTP startup line that stdio never
  // prints. Driven through the SDK's own stdio client instead, so this is the real entry
  // point over a real pipe — the assertion is that the tool list comes back intact, not that
  // a log happens to be quiet.
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"],
    cwd: ROOT,
    // No token, deliberately: the token belongs to the HTTP transport, and a local process
    // that is spawned by its own client has nobody to authenticate. Blanked rather than
    // omitted so a token in the developer's shell cannot make this pass for the wrong reason.
    env: { ...process.env, MCP_TRANSPORT: "stdio", MCP_AUTH_TOKEN: "" },
    stderr: "pipe",
  });

  let stdout = "";
  transport.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.equal(tools.length, EXPECTED_TOOLS, "stdio serves the whole surface");
    assert.ok(textOf(await client.callTool({ name: "plan_creator", arguments: {} })).length > 0);

    assert.equal(stdout, "", `stdout must stay empty, got: ${stdout}`);

    // The fork is the thing being ruled out, so it is asserted rather than assumed. The
    // handshake above already implies it — a forked worker writing a startup line to the
    // inherited stdout would have corrupted the stream before the initialize response
    // arrived — but "would have" is a claim about a failure that did not happen, and this
    // costs one line.
    assert.doesNotMatch(stderr, /forking \d+ HTTP workers/);
    assert.doesNotMatch(stderr, /serving over http/);
  } finally {
    await client.close();
  }
});

/* -------------------------------------------------------------------------- *
 * The workers.
 * -------------------------------------------------------------------------- */

test(
  "a worker does not grow across many requests",
  // The property the SSE session map got wrong, and the reason a stateless transport is
  // more than a tidier design here. The old route kept a `Map` keyed by connection and
  // relied on `res.on("close")` to delete every entry; on an unauthenticated public port
  // that map is a memory-growth primitive the moment a client stops closing cleanly.
  //
  // Measured rather than asserted structurally, because "the Set is emptied on close" is an
  // argument and a leak shows up as bytes. The thresholds are deliberately loose — a
  // warm-up pass first, because V8 grows its heap on demand and the first hundred requests
  // are the JIT warming up, not a leak — and this is a smoke test against unbounded growth,
  // not a benchmark.
  //
  // Pinned to `MCP_CLUSTER_WORKERS=1`, where **the process the test spawned is the process
  // that answers**: with the fork disabled there is no separate worker, so the pid to
  // measure is the primary's own. One number, one process.
  { skip: process.platform === "win32" ? "no /proc on Windows" : false },
  async () => {
    const { readFile } = await import("node:fs/promises");

    /** Resident set size of `pid`, in bytes, from `/proc`. */
    const rssOf = async (pid) => {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      const line = status.split("\n").find((row) => row.startsWith("VmRSS:"));
      return Number.parseInt(line.split(/\s+/)[1], 10) * 1024;
    };

    await withServer(
      { env: { MCP_CLUSTER_WORKERS: "1" } },
      async ({ child, url }) => {
        const hammer = async (times) => {
          for (let i = 0; i < times; i += 1) {
            const response = await fetch(`${url}/healthz`);
            assert.equal(response.status, 200);
            await response.arrayBuffer();
          }
        };

        await hammer(100);
        const before = await rssOf(child.pid);
        await hammer(400);
        const after = await rssOf(child.pid);

        // 32 MB over 400 requests. A leak of the old shape would be several kilobytes per
        // request and several megabytes over that many; this is loose enough to survive a GC
        // cycle landing late and tight enough that "each request retained something" cannot
        // pass.
        const growth = after - before;
        assert.ok(
          growth < 32 * 1024 * 1024,
          `the worker grew ${(growth / 1024 / 1024).toFixed(1)} MB over 400 requests ` +
            `(${Math.round(before / 1024 / 1024)} MB -> ${Math.round(after / 1024 / 1024)} MB)`
        );
      }
    );
  }
);

test("MCP_CLUSTER_WORKERS=1 forks nothing and serves on its own", async () => {
  await withServer(
    { env: { MCP_CLUSTER_WORKERS: "1" } },
    async ({ output, countOutput, url }) => {
      assert.match(output(), /MCP_CLUSTER_WORKERS is 1, so no worker is forked/);
      assert.doesNotMatch(output(), /forking \d+ HTTP workers/);
      assert.equal(countOutput("serving over http"), 1, "one process, one startup line");

      // Still a working server: disabling the fork must not disable the transport.
      const client = await connect(url);
      openClients.add(client);
      try {
        assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS);
      } finally {
        await client.close();
        openClients.delete(client);
      }
    }
  );
});

test("MCP_CLUSTER_WORKERS=2 binds the port from two separate workers", async () => {
  await withServer(
    { env: { MCP_CLUSTER_WORKERS: "2" } },
    async ({ output, countOutput, waitForCount, url }) => {
      assert.match(output(), /forking 2 HTTP workers on :\d+\/mcp/);

      // Two startup lines means two processes each bound the port — which only happens
      // through the cluster's shared handle, because two independent `listen` calls on one
      // port would be EADDRINUSE. This is the assertion that the fork is real.
      assert.ok(
        await waitForCount("serving over http", 2),
        `expected two workers to bind, saw ${countOutput("serving over http")}\n--- output ---\n${output()}`
      );

      // And the primary claimed no port of its own.
      assert.equal(countOutput("MCP_ALLOWED_HOSTS is unset"), 2, "one warning per worker");

      // And both are answering: enough concurrent requests to outlast a single-process
      // server's accept loop, each on its own connection.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => fetch(`${url}/healthz`))
      );
      for (const response of responses) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).server, SERVER_NAME);
      }
    }
  );
});

test("concurrent tool calls stay isolated when they cross a process boundary", async () => {
  // The property `cluster` can plausibly break. Each request builds its own McpServer in
  // whichever worker wins the connection, so three callers asking for three different files
  // must each get their own — and the workers are separate processes, so a module-level cache
  // that happened to work in one process would have to hold in two of them to pass.
  await withServer(
    { env: { MCP_CLUSTER_WORKERS: "2" } },
    async ({ waitForCount, url }) => {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const tools = ["commit_conventions", "plan_creator", "versioning"];
      const clients = await Promise.all(tools.map(() => connect(url)));
      for (const client of clients) openClients.add(client);

      try {
        const results = await Promise.all(
          clients.map((client, i) => client.callTool({ name: tools[i], arguments: {} }))
        );

        for (const [i, result] of results.entries()) {
          // The file's own name is in its frontmatter, so this distinguishes "answered with
          // the right file" from "answered with some file". Tool names are derived from
          // filenames by replacing hyphens with underscores, so the served text carries the
          // hyphenated form — that derivation is what is being inverted here.
          const ownName = tools[i].replace(/_/g, "-");
          assert.ok(
            textOf(result).includes(`name: ${ownName}`),
            `${tools[i]} was answered with another request's file`
          );
        }
      } finally {
        await Promise.all(clients.map((client) => client.close()));
        for (const client of clients) openClients.delete(client);
      }
    }
  );
});

test(
  "no worker outlives a primary that was killed outright",
  // The failure this catches does not show up in this run. A worker whose primary is gone
  // keeps the port and keeps answering, so the suite passes, and then the *next* run fails
  // on EADDRINUSE against a process nobody remembers starting. `after()` kills the primary
  // with SIGKILL on every failing run, so without the `disconnect` handler this file would
  // leak two processes per failed run.
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    const { child, port, url, waitForCount } = await startServer({
      env: { MCP_CLUSTER_WORKERS: "2" },
    });

    try {
      assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));

      // SIGKILL cannot be caught, handled, or forwarded. The primary leaves instantly and the
      // workers are told only through the IPC channel that closes with it.
      child.kill("SIGKILL");
      await exited;

      // A worker takes a moment to notice the disconnect and exit. The generous window is
      // the point: a check that ran immediately would pass even when the handler is missing,
      // because the orphan has not finished dying yet.
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));

      // The proof, in two parts. The port stops answering...
      await assert.rejects(
        fetch(`${url}/healthz`),
        `the port is still served after the primary died - port ${port} has an orphan`
      );
      // ...and it is genuinely free, which a request that merely timed out would not show:
      // something else can bind it again.
      const rebound = createNetServer();
      try {
        await new Promise((resolveBind, rejectBind) => {
          rebound.on("error", rejectBind);
          rebound.listen(port, "127.0.0.1", resolveBind);
        });
      } finally {
        await new Promise((resolveClose) => rebound.close(resolveClose));
      }
    } finally {
      child.kill("SIGKILL");
    }
  }
);

test(
  "the cluster drains on SIGINT and exits 0",
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer(
      { env: { MCP_CLUSTER_WORKERS: "2" } },
      async ({ child, output, waitForCount }) => {
        assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

        const exited = new Promise((resolveExit) =>
          child.once("exit", (code, signal) => resolveExit({ code, signal }))
        );
        child.kill("SIGINT");
        const { code, signal } = await exited;

        assert.equal(code, 0, `the primary did not exit cleanly: signal ${signal}`);

        // The primary says it is draining its workers, and each worker says it is draining
        // itself. Both lines, because the primary relays the signal rather than killing its
        // workers outright — a worker killed mid-request would drop a response the client is
        // still reading.
        assert.match(output(), /SIGINT, draining 2 worker\(s\)/);
        assert.equal(
          output().split("SIGINT, draining").length - 1,
          3,
          "the primary plus both workers should report a drain"
        );

        // And what the workers drained is requests, not sessions. There is no session store
        // left to count, and a line still reading `session(s)` would describe a transport
        // that no longer exists.
        assert.equal(
          output().split(/SIGINT, draining \d+ in-flight request\(s\)/).length - 1,
          2,
          "both workers should report the shape of what they drained"
        );
      }
    );
  }
);

test(
  "a second signal stops the wait rather than queueing behind the first",
  { skip: process.platform === "win32" ? "no signal delivery on Windows" : false },
  async () => {
    await withServer(
      { env: { MCP_CLUSTER_WORKERS: "2" } },
      async ({ child, output, waitForCount }) => {
        assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

        const exited = new Promise((resolveExit) =>
          child.once("exit", (code) => resolveExit({ code }))
        );

        child.kill("SIGINT");
        child.kill("SIGINT");

        const { code } = await exited;
        assert.equal(code, 0);

        // What is asserted is the *observable* half of the early-exit path: the primary's
        // drain line is written once. A second signal that fell through to the full drain
        // would print it again, and the guarded flag in `startPrimary` is what stops that.
        // The suite cannot force a worker to be slow enough to make the second signal land
        // mid-drain, so the timing the branch exists for — an operator who has stopped
        // waiting — is not exercised here.
        assert.equal(output().split("SIGINT, draining 2 worker(s)").length - 1, 1);
      }
    );
  }
);

test(
  "a worker that dies is replaced, and the server keeps serving",
  // The suite knows the primary's pid — it spawned it — but not its workers' pids: the
  // startup line is pinned by other tests and adding a pid to it, or to the health check,
  // would change a surface this task was not asked to change. So the pids are read from the
  // kernel instead, which is the one source that knows them and is Linux only. Elsewhere
  // this stays unchecked rather than being asserted by a weaker proxy.
  { skip: process.platform === "linux" ? false : "worker pids are read from /proc" },
  async () => {
    const { readFile } = await import("node:fs/promises");

    /**
     * The direct children of `pid`, from `/proc`.
     *
     * `children` lives under the thread directory rather than the process one, which is the
     * shape the kernel has and the shape every tool on Linux expects.
     */
    const childrenOf = async (pid) => {
      const listed = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
      return listed.split(/\s+/).filter(Boolean).map(Number);
    };

    await withServer(
      { env: { MCP_CLUSTER_WORKERS: "2" } },
      async ({ child, output, waitForCount, waitForOutput, url }) => {
        assert.ok(await waitForCount("serving over http", 2), "the fork did not happen");

        const workers = await childrenOf(child.pid);
        assert.equal(workers.length, 2, `expected two workers, found ${workers.join(", ")}`);

        // `process.kill`, not `child.kill`: the latter takes a signal and nothing else, so
        // passing a pid as a second argument silently kills the *primary* instead — which
        // looks like a server that ignores its workers dying.
        process.kill(workers[0], "SIGKILL");

        // The replacement is a new pid, not the old one coming back, and the primary says so
        // out loud rather than silently refilling the pool.
        assert.ok(
          await waitForOutput(`worker ${workers[0]} exited`),
          `the primary did not report the death\n--- output ---\n${output()}`
        );

        assert.ok(await waitForCount("serving over http", 3), "the replacement did not bind the port");

        const after = await childrenOf(child.pid);
        assert.equal(after.length, 2, "the pool is back to two");
        assert.ok(!after.includes(workers[0]), "a dead pid is not back");
        assert.ok(after.includes(workers[1]), "the surviving worker was left alone");

        // And the server is still answering, on the pool it has now.
        assert.equal((await fetch(`${url}/healthz`)).status, 200);
      }
    );
  }
);

/* -------------------------------------------------------------------------- *
 * Authentication.
 *
 * The transport decides: HTTP needs the bearer token, stdio never does. Every test above runs
 * against a server that was handed `TEST_TOKEN`, so none of them is about this — these are.
 * -------------------------------------------------------------------------- */

/** A JSON-RPC `tools/list`, with the headers the Streamable HTTP transport insists on. */
const LIST_TOOLS = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
};

/** `LIST_TOOLS` with an extra header merged in. */
const withHeaders = (extra) => ({ ...LIST_TOOLS, headers: { ...LIST_TOOLS.headers, ...extra } });

/**
 * Start a process that is expected to stop, and report how it stopped.
 *
 * `startServer` waits for a startup line and treats an early exit as a failure to come up, which
 * is exactly what these tests assert should happen — so they need the exit, not the failure.
 *
 * @param {{ entry?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<{ code: number | string | null, output: string }>}
 */
async function runToExit({ entry = ENTRY_HTTP, env = {} } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...env },
  });
  openServers.add(child);

  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  return new Promise((resolveRun) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveRun({ code: "still running", output });
    }, 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      openServers.delete(child);
      resolveRun({ code, output });
    });
  });
}

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
  await withServer({}, async ({ url, output }) => {
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

test("HTTP refuses to start without a usable token", async () => {
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
    const { code, output } = await runToExit({ env: { MCP_AUTH_TOKEN: token } });

    assert.equal(code, 1, `${name}: it must exit 1, got ${code}\n${output}`);
    assert.match(output, message, name);
    assert.match(output, /openssl rand -hex 32/, `${name}: the message must say how to fix it`);
    assert.doesNotMatch(output, /serving over http/, `${name}: it must not have bound the port`);
    if (token.trim()) assert.ok(!output.includes(token), `${name}: the value must not be echoed`);
  }
});

test("the refusal to start is the same through src/index.js, and printed once however many workers", async () => {
  for (const env of [
    { MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: "" },
    { MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: "", MCP_CLUSTER_WORKERS: "3" },
  ]) {
    const { code, output } = await runToExit({ entry: ENTRY_INDEX, env });

    assert.equal(code, 1, output);
    assert.equal(output.split("will not start the HTTP transport").length - 1, 1, output);
    assert.doesNotMatch(output, /forking \d+ HTTP workers/);
    assert.doesNotMatch(output, /worker \d+ exited/, "a missing token must not become a respawn loop");
  }
});

test("createApp cannot be built without a usable token", () => {
  const saved = process.env.MCP_AUTH_TOKEN;
  try {
    delete process.env.MCP_AUTH_TOKEN;
    assert.throws(() => createApp(), /Refusing to build the HTTP app: MCP_AUTH_TOKEN is not set/);
    assert.throws(() => createApp({ token: "short" }), /must be at least 32/);
    assert.throws(() => createApp({ token: "" }), /is not set/);

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
