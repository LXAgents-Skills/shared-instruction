import assert from "node:assert/strict";
import test from "node:test";
import { createServer as createNetServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SERVER_NAME } from "../src/version.js";
import {
  EXPECTED_TOOLS,
  ROOT,
  ENTRY_INDEX,
  textOf,
  startServer,
  withServer,
  connect,
  openClients,
} from "./helpers/http-harness.js";

/**
 * The HTTP transport over a real socket: the two entry points, and the workers.
 *
 * Shared setup is in `helpers/http-harness.js`.
 */

test("MCP_TRANSPORT=http reaches the same server through src/index.js", async () => {
  // The delegation is a separate behaviour from the server. `package.json`'s `start:http`
  // and the `Dockerfile` both name `src/http.js` and neither may change, so the transport
  // selection lives in `src/index.js` and reaches the entry point by dynamic import. If
  // that hop broke, `npm run start:http` would keep working and every client configured
  // with `MCP_TRANSPORT=http` would silently fall back to stdio.
  await withServer(
    { entry: ENTRY_INDEX, env: { MCP_TRANSPORT: "http" } },
    async ({ url, stdout, output }) => {
      assert.match(output(), /serving Skill MCP over http on :\d+\/mcp/);

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
    assert.doesNotMatch(stderr, /serving Skill MCP over http/);
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
      assert.equal(countOutput("serving Skill MCP over http"), 1, "one process, one startup line");

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
        await waitForCount("serving Skill MCP over http", 2),
        `expected two workers to bind, saw ${countOutput("serving Skill MCP over http")}\n--- output ---\n${output()}`
      );

      // And the primary claimed no port of its own. Each worker writes this line just after its
      // startup line, so it is waited for rather than counted at once: under load the second
      // worker's warning can arrive a moment after its startup line has been seen.
      await waitForCount("MCP_ALLOWED_HOSTS is unset", 2);
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
      assert.ok(await waitForCount("serving Skill MCP over http", 2), "the fork did not happen");

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
      assert.ok(await waitForCount("serving Skill MCP over http", 2), "the fork did not happen");

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
        assert.ok(await waitForCount("serving Skill MCP over http", 2), "the fork did not happen");

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
        assert.ok(await waitForCount("serving Skill MCP over http", 2), "the fork did not happen");

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
        assert.ok(await waitForCount("serving Skill MCP over http", 2), "the fork did not happen");

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

        assert.ok(await waitForCount("serving Skill MCP over http", 3), "the replacement did not bind the port");

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
