import assert from "node:assert/strict";
import { after } from "node:test";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, INSTRUCTION_MODULES } from "../../src/server.js";

/**
 * The shared harness for the HTTP suites: the token, the entry points, and the helpers that
 * start a real server as a child process and connect to it.
 *
 * Every `test/http.*.test.js` file imports from here. The `after()` hooks below run once per
 * test file, because `node --test` runs each file in its own process, so a failed assertion in
 * any suite still cannot leak a child or a client.
 */

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
export const EXPECTED_TOOLS = INSTRUCTION_MODULES.length;
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

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The two entry points, named rather than assumed.
 *
 * `src/http.js` is what `npm run start:http` and the `Dockerfile` run, and most of this
 * file drives it. `src/index.js` is what a client spawns, and the delegation to
 * `src/http.js` on `MCP_TRANSPORT=http` is a separate behaviour with its own test — a
 * change that made `npm run start:http` work and `MCP_TRANSPORT=http` fail would be the
 * kind of near miss that reads as a working server.
 */
export const ENTRY_HTTP = join(ROOT, "src", "http.js");
export const ENTRY_INDEX = join(ROOT, "src", "index.js");

/**
 * The token every server started by this file runs with, unless a test says otherwise.
 *
 * The HTTP transport will not start without one, and refuses every request that does not carry
 * it. Defaulting it in `startServer` keeps the tests that are about something else — the
 * workers, the body limit, the allow-list — about that thing rather than about authentication.
 * Long enough to pass the length check, and obviously not a real secret.
 */
export const TEST_TOKEN = "test-token-0123456789abcdef0123456789abcdef";

/** An `Authorization` header carrying `token`. */
export const bearer = (token = TEST_TOKEN) => ({ authorization: `Bearer ${token}` });

/**
 * How long to wait for the startup line.
 *
 * A deadline rather than a sleep, so the common case costs nothing: the server is up in well
 * under a second on a normal filesystem. It is generous because a checkout on a network or
 * 9p mount can take several seconds just to load the SDK, and a deadline that is too short
 * fails a working server for an environmental reason.
 */
export const READY_TIMEOUT_MS = 30_000;

/** The text of a single-content tool result. */
export function textOf(result) {
  assert.notEqual(result.isError, true, "expected a successful result");
  assert.equal(result.content.length, 1, "expected exactly one content block");
  return result.content[0].text;
}

/** A free port, so parallel runs do not collide. */
export function freePort() {
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
export const openServers = new Set();

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
export async function startServer({ entry = ENTRY_HTTP, env = {} } = {}) {
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
    waitForOutput("serving Skill MCP over http").then((ok) => ({ ok })),
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
export async function withServer(options, run) {
  const server = await startServer(options);
  try {
    return await run(server);
  } finally {
    server.child.kill("SIGKILL");
  }
}

/** Connect an MCP client to a running server over a real socket, carrying the test token. */
export async function connect(url, { token = TEST_TOKEN } = {}) {
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
export const openClients = new Set();

after(async () => {
  await Promise.allSettled([...openClients].map((client) => client.close()));
  openClients.clear();
});

/** An in-memory client, the reference the socket client is compared against. */
export async function inMemoryClient() {
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
export function requestWithHost({ url, host, path = "/healthz" }) {
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

/** A JSON-RPC `tools/list`, with the headers the Streamable HTTP transport insists on. */
export const LIST_TOOLS = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
};

/** `LIST_TOOLS` with an extra header merged in. */
export const withHeaders = (extra) => ({ ...LIST_TOOLS, headers: { ...LIST_TOOLS.headers, ...extra } });

/**
 * Start a process that is expected to stop, and report how it stopped.
 *
 * `startServer` waits for a startup line and treats an early exit as a failure to come up, which
 * is exactly what these tests assert should happen — so they need the exit, not the failure.
 *
 * @param {{ entry?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<{ code: number | string | null, output: string }>}
 */
export async function runToExit({ entry = ENTRY_HTTP, env = {} } = {}) {
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
