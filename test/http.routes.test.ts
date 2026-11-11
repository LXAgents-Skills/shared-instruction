import assert from "node:assert/strict";
import test from "node:test";
import { toolId } from "../src/instructions/from-content.js";
import { SERVER_NAME } from "../src/version.js";
import {
  EXPECTED_TOOLS,
  bearer,
  textOf,
  withServer,
  connect,
  openClients,
  inMemoryClient,
  type ExitStatus,
} from "./helpers/http-harness.js";

/**
 * The HTTP transport over a real socket: the routes, the transport, and isolation between requests.
 *
 * Shared setup is in `helpers/http-harness.js`.
 */

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
    assert.match(output(), /serving Skill MCP over http on :\d+\/mcp \(127\.0\.0\.1\)/);
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
      textOf(await client.callTool({ name: toolId("branching_strategy"), arguments: {} }));
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
        name: toolId("branching_strategy"),
        arguments: { path: "../../etc/passwd" },
      });
      assert.equal(
        textOf(withArgument),
        textOf(await client.callTool({ name: toolId("branching_strategy"), arguments: {} })),
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
        await client.callTool({ name: toolId("branching_strategy"), arguments: {} })
      );
      const overMemory = textOf(
        await memory.client.callTool({ name: toolId("branching_strategy"), arguments: {} })
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
        clients.map((client, i) => client.callTool({ name: toolId(tools[i]), arguments: {} }))
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
        textOf(await clients[0].callTool({ name: toolId("commit_conventions"), arguments: {} }))
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
      const exited = new Promise<ExitStatus>((resolveExit) =>
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
