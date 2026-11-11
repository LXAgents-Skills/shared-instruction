#!/usr/bin/env node
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { allowedHosts, createApp } from "./app.js";
import { MIN_TOKEN_LENGTH, tokenProblem } from "./auth.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * The HTTP entry point, and the cluster that runs it.
 *
 * **This file, and not `src/index.js`, is what `npm run start:http` and the `Dockerfile`
 * name** — and neither may change, because the documented Docker command is
 * `node src/http.js`. Everywhere else in the organization the cluster and the port live in
 * `src/index.js`; here they live here, and `src/index.js` reaches this file by dynamic
 * import when `MCP_TRANSPORT=http` is set. The fork belongs on this path, not on the
 * stdio one. One extra hop, forced by a file that must not move. The task record under
 * `.agents/memory/tasks/` has the reasoning.
 *
 * The application itself is in `src/app.js`, which builds and returns an express app and
 * does not listen. Every route but `GET /healthz` needs the bearer token in `MCP_AUTH_TOKEN`,
 * and this process will not start without one. This file owns the port, the interface, the workers, the startup lines,
 * and the drain.
 */

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

/**
 * Where the process says things.
 *
 * stderr, and not stdout. The stdio entry point is the reason: on that transport stdout
 * *is* the JSON-RPC channel, and `src/index.js` reaches this file to start HTTP, so a
 * process that logs to stdout would be correct on one entry point and a protocol
 * corruption on the other. The rule is easier to hold as one rule than as an exception —
 * and a forked worker that wrote to the inherited stdout would corrupt the stream twice
 * over, once per copy of it.
 */
function log(line) {
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
}

/**
 * How many HTTP workers to run.
 *
 * `MCP_CLUSTER_WORKERS` overrides the count. **A value of 1 means no forking at all** — one
 * process, one listener, the pre-cluster behaviour — which is what makes the cluster
 * bisectable: the same code answers, with and without workers, and a difference between
 * them is a difference in the fork rather than in the transport.
 *
 * Unset, the count is the number of CPUs the process was actually given, not a constant: a
 * container with two CPUs gets two workers and a laptop does not get eight.
 *
 * A value below 1 is not a count and is ignored rather than clamped, so `MCP_CLUSTER_WORKERS=0`
 * says "I did not mean to set this" rather than "run no workers", which would be a server
 * that binds nothing and looks healthy.
 *
 * @returns {number}
 */
function workerCount() {
  const configured = Number.parseInt(process.env.MCP_CLUSTER_WORKERS ?? "", 10);
  if (Number.isInteger(configured) && configured >= 1) return configured;
  return Math.max(1, availableParallelism());
}

/**
 * The worker: the process that actually answers.
 *
 * Every worker binds the same `PORT`. The kernel's shared handle and the round-robin
 * scheduler do the distribution — no `SO_REUSEPORT` is set by hand and no sticky-session
 * logic is written, because the scheduler already has the information (which connection is
 * next) that a sticky-session scheme would have to reconstruct.
 */
function startWorker() {
  // A worker whose primary is gone holds the port for whoever starts next. The test harness
  // kills the child process directly, so this is the difference between a suite that passes
  // and one that fails on its *second* run with EADDRINUSE against a process nobody
  // remembers starting.
  process.on("disconnect", () => process.exit(0));

  /**
   * Requests currently being answered, and the closers that end them.
   *
   * **This is what replaced the SSE session map, and it is deliberately not the same shape.**
   * The map counted live *sessions* — state a client held open across requests, keyed by an
   * id it was handed, deleted when its stream closed. None of that exists here: each request
   * carries everything it needs, so there is nothing to key and nothing to look up. A `Set`
   * of closers is what a shutdown can actually act on, which is why it replaces the map
   * rather than impersonating it: `inFlight.size` is the drain count, and the entries are how
   * a stuck request is ended rather than waited on forever.
   *
   * Per worker, which is what makes it per worker correct: each process has its own requests
   * and its own `McpServer` per request, and nothing is shared between them.
   *
   * @type {Set<() => void>}
   */
  const inFlight = new Set();

  const server = createApp({ inFlight }).listen(PORT, HOST, () => {
    const where = HOST === "0.0.0.0" ? "all interfaces" : HOST;
    log(`${SERVER_NAME} ${VERSION} serving Skill MCP over http on :${PORT}/mcp (${where})`);

    // The token is required for the process to be here at all, so this line is a statement
    // of fact and not a warning. It never carries the value.
    log(`${SERVER_NAME} ${VERSION} bearer token required on every route except GET /healthz.`);

    // Said out loud, because the default is the unguarded one. Someone reading a container's
    // startup log is the only person who can act on it, and a control that is off silently
    // is worse than no control at all — it reads as present. Printed once per worker, which
    // is one line per process that genuinely holds the port.
    if (allowedHosts().length === 0) {
      log(`${SERVER_NAME} ${VERSION} MCP_ALLOWED_HOSTS is unset, so no Host header allow-list is applied.`);
    }
  });

  /**
   * Shutdown, in this order.
   *
   * The listener closes first, so nothing new arrives — a request accepted during the drain
   * gets an answer rather than a refused connection. Then idle keep-alive sockets are
   * closed, because `close()` waits on them and a client that opened one and went quiet would
   * hold the process open indefinitely for a request that no longer exists. Then a short
   * grace period, after which whatever is genuinely still in flight is cut off rather than
   * waited on forever.
   *
   * The count is `inFlight.size`, and that is the number the SSE version printed as
   * `sessions.size` under a different word. **There is no session store to drain here** —
   * each request is self-contained, a fresh `McpServer` closed when its response closes — so
   * what drains is the requests. The line changed shape with that, and so did the test that
   * reads it.
   *
   * @param {string} signal
   */
  let shuttingDown = false;

  const shutdown = (signal) => {
    // A second signal means the operator has stopped waiting.
    if (shuttingDown) {
      process.exit(0);
    }
    shuttingDown = true;
    log(`${signal}, draining ${inFlight.size} in-flight request(s)`);

    const forced = setTimeout(() => {
      server.closeAllConnections();
      for (const close of [...inFlight]) close();
    }, 5000);
    forced.unref();

    server.close(() => {
      clearTimeout(forced);
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * The primary: the process that forks workers and does not serve.
 *
 * It binds nothing, so **it writes no `serving over http` line of its own**. The startup
 * lines in a container's log then describe ports that are genuinely open — one per worker,
 * from the processes that opened them. A primary that logged a listening line would be
 * claiming a port it does not hold, and a health check that counted those lines would count
 * a process that answers nothing.
 */
function startPrimary() {
  // Fail closed, before anything is forked. HTTP without a token is an open door on a network,
  // and the only thing that can be done about it is not to start. Checked here as well as in
  // `createApp` because here it is reported once: left to the workers, a missing token would be
  // the same line printed by each of them and then a respawn loop through the crash limit.
  //
  // `exitCode` and a return, not `process.exit()`: nothing is listening yet, so the process
  // ends on its own once the line is written, and the line is never cut off.
  const problem = tokenProblem();
  if (problem) {
    log(
      `${SERVER_NAME} ${VERSION} will not start the HTTP transport: ${problem}. ` +
        `Set MCP_AUTH_TOKEN to a secret of at least ${MIN_TOKEN_LENGTH} characters, for example ` +
        "the output of: openssl rand -hex 32. stdio needs no token.",
    );
    process.exitCode = 1;
    return;
  }

  const count = workerCount();

  // Read by the respawn handler below, and set by the signal handler further down, so it is
  // declared before either can run rather than beside the one that reads it first.
  let draining = false;

  if (count <= 1) {
    // No fork. The worker path is the whole server, and the line below is what a
    // single-process run prints; saying so is worth a line of its own. The wording names
    // whichever of the two settings actually produced the count, because "MCP_CLUSTER_WORKERS
    // is 1" is a false statement about a machine that simply has one CPU.
    const why = process.env.MCP_CLUSTER_WORKERS
      ? `MCP_CLUSTER_WORKERS is ${count}`
      : `availableParallelism() is ${count}`;
    log(`${SERVER_NAME} ${VERSION} ${why}, so no worker is forked.`);
    startWorker();
    return;
  }

  log(`${SERVER_NAME} ${VERSION} forking ${count} HTTP workers on :${PORT}/mcp`);

  /**
   * A worker that exits unexpectedly is replaced, but not forever: a server that cannot
   * start its workers is a server that should say so and stop, not one that respawns into a
   * crash loop nobody is watching.
   */
  let starts = 0;

  cluster.on("exit", (worker, code, signal) => {
    if (draining) return;
    if (starts > count * 10) {
      log(`${SERVER_NAME} ${VERSION} a worker exited ${code ?? signal} ${starts} times, not restarting it.`);
      process.exit(1);
      return;
    }
    log(`${SERVER_NAME} ${VERSION} worker ${worker.process.pid} exited ${code ?? signal}, restarting it`);
    forkWorker();
  });

  function forkWorker() {
    starts += 1;
    cluster.fork();
  }

  for (let i = 0; i < count; i += 1) forkWorker();

  /**
   * Relay the signal, then wait.
   *
   * The signal goes to the workers rather than being handled here alone, because the workers
   * hold the requests and the listener. The primary exits when the last worker is gone, so
   * the port is genuinely closed before the process that started it is — a test that stops
   * the server and then checks the port is refused must not race a primary that exits while
   * its workers are still answering.
   */
  const shutdown = (signal) => {
    // A second signal means the operator has stopped waiting.
    if (draining) {
      process.exit(0);
    }
    draining = true;

    const workers = Object.values(cluster.workers ?? {}).filter(Boolean);
    log(`${SERVER_NAME} ${VERSION} ${signal}, draining ${workers.length} worker(s)`);

    // Unref'd: this timer is a backstop for a wedged worker, not a reason to keep the process
    // alive when every worker has already gone.
    const forced = setTimeout(() => process.exit(0), 10_000);
    forced.unref();

    let remaining = workers.length;
    for (const worker of workers) {
      worker.once("exit", () => {
        remaining -= 1;
        if (remaining === 0) {
          clearTimeout(forced);
          process.exit(0);
        }
      });
    }

    for (const worker of workers) worker.kill(signal);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (cluster.isPrimary) {
  startPrimary();
} else {
  startWorker();
}
