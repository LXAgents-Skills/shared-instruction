# Security Model

The security posture of `LXAgents-Skills/shared-instruction` specifically. It is scoped to
this repository and describes nothing about the repositories that consume the set — each
one keeps its own model, and they are deliberately not merged.

## What this project actually is, in security terms

A read-only publisher. It reads markdown from `content/` once at boot into a frozen map and
serves it over Skill MCP. There is no database, no user accounts, and nothing persisted at
runtime.

**It has two transports, and one of them is a network listener.** `src/index.js` speaks
stdio, which is a pipe a client spawns. `src/http.js` speaks stateless HTTP, which binds a
port. The second is newer than this page's previous revision, and it changes the shape of
everything below: the interesting risk is still not data theft, because the content is
public by design, but a listener adds a reachability question that a pipe does not have. The
answer to it is a bearer token, required on every HTTP request and absent from stdio.

That shape decides most of what follows: the content is **instructions an agent will obey
in someone else's repository**, and that remains the risk that reaches furthest.

## The trust boundary that matters most

`content/` is published to every consuming repository as standing orders. An agent in
another repository reads it and treats it as authoritative — that is the entire point of
the connector.

So a wrong instruction in `content/` is not a documentation bug. It is an
instruction-injection vector with organization-wide reach, and it needs no exploit to
trigger: consumers pick a change up on their next read, with no upgrade step and no
review on their side.

Concretely, text merged into `content/` can direct another repository's agent to run a
command, write a file, weaken a convention, or skip a permission gate. Review a
`content/` diff as you would review code that runs on someone else's machine, because in
effect it does. This is why `content/` changes are versioned and logged like a release —
the log entry is the only notice a consumer ever gets.

Note what makes this worse rather than better: the set is published to npm. Nothing in the
distribution path is a review either.

## Attack surface

| Surface | Exposure | What guards it |
|---|---|---|
| Instruction calls | Whoever can spawn the process (stdio), whoever is on this machine (HTTP on loopback with no token), or whoever holds the token (HTTP otherwise) | **Nothing beyond that, and that is the design.** Every tool is read-only and takes no argument. There is no path, no verb, and no target a caller can supply. |
| Path reads | None | No tool takes a path and nothing opens a file a caller named. The set is read once at boot from a fixed directory. Detailed below. |
| **The HTTP listener** | **Anyone who can reach the port** | **A bearer token**, `MCP_AUTH_TOKEN`: every route except `GET /healthz` refuses without it, and off loopback the process will not start without one. On loopback with no token, the bind keeps other machines out and a `Host` allow-list of `localhost`, `127.0.0.1` and `[::1]` keeps out DNS rebinding. Otherwise an optional `Host` allow-list via `MCP_ALLOWED_HOSTS`, **off unless set**. No TLS and no rate limiting — those belong to whatever fronts the port. Detailed below. |
| In-flight requests | Anyone who holds the token | One `McpServer` per request, never shared, closed when its response closes. **The set of them is per-request closers, not a map of live sessions** — a stateless transport has no id to key on and keeps nothing between requests, so there is no store to fill. |
| Process startup | Anyone who can spawn it | Reads `package.json` and walks `content/`. Malformed content throws and the process exits rather than serving something wrong. |
| Dependency install | Build time | `npm install` runs lifecycle scripts. `npm ci --ignore-scripts` is the safer form for a build you do not control. |
| Publishing | Anyone with npm credentials | Publishing changes what every consumer reads. Treat a release as a security-relevant action, because it is one. |

## The HTTP listener

This section is new, and it is the part of this page that most deserves scepticism from a
reader who trusted the previous revision.

**What it changes.** A stdio server is reachable only by whoever can spawn the process. An
HTTP server is reachable by anyone who can open a socket to it. That is the whole
difference, and it is not a small one: the exposure is no longer "who can read this
repository" but "who can reach this port".

**What it does not change.** Every tool is still read-only, still takes no argument, and
still returns one of the same public files. A caller who reaches the port gets exactly
what a caller who clones the repository and runs it locally gets. There is no privileged
operation to reach and no state to corrupt. The listener widens who can ask, not what they
can do once they have — and it now asks them for one credential before it answers.

**And the worker pool does not widen it either.** `src/http.js` forks one process per CPU by
default, but every worker binds the same port and serves the same 33 read-only tools, so the
pool multiplies capacity rather than surface. Two things follow that are worth stating:
there is still nothing shared between workers to corrupt — each builds its own `McpServer`
per request — and the `Host` allow-list is evaluated by every worker independently, so
there is no way to reach a worker that skipped it.

**Authentication, and what it is for.** The transport decides. A stdio server is a pipe the
client spawns on its own machine, so the only caller is whoever already runs the process and
there is nobody to authenticate. An HTTP server bound to any interface but loopback is a socket
anyone who can reach the port can open, so every request must carry
`Authorization: Bearer <token>` matching `MCP_AUTH_TOKEN`, and the process refuses to start
without one.

**HTTP on loopback is a local install, and may run without a token** (since `6.0.3`, at the
owner's request; `5.0.0` refused this waiver). Only this machine can open a loopback socket, so
the residual callers are other processes and users on the same machine, and web pages in its
browser. The second are stopped by the `Host` allow-list a token-less local server always has.
**A reverse proxy, tunnel or port-forward in front of a token-less loopback server turns it into
an open server** — set `MCP_AUTH_TOKEN` before exposing it in any way. A token set on loopback is
enforced exactly as off it.

**What the token gates is the service, not the text.** The content is an instruction set
meant to be read by every repository in the organization, and it is also on npm; a token does
not make a single byte of it confidential. What it controls is who may use a *deployed
instance*: a caller without it is refused before a body is read or a route is revealed, so the
instance is not an open service for anyone who finds the address, and the owner can cut off
every holder at once by changing the variable. That is a smaller claim than "this is private",
and it is the only one made.

**How it is built, and why each part is the way it is.**

* **Fail closed.** The process exits `1` with one line if the token is unset or under 32
  characters, and `createApp` throws too, so an unauthenticated HTTP server cannot come from
  forgetting an option, calling the app directly, or a typo in the variable's name. There is
  no flag that turns it off. The check runs in the primary before any worker is forked:
  left to the workers, a missing token would be a respawn loop through the crash limit.
* **Constant-time comparison** over SHA-256 digests, so neither the token's length nor how
  much of a guess was right shows in the response time.
* **Header only.** No query-string form, because a URL ends up in access logs, proxies and
  browser history.
* **Before everything else that costs something.** After the `Host` allow-list and before the
  body parser and every route. An unauthenticated caller cannot make the server read and parse
  up to 4 MB, and cannot tell a `404` from a `405`, so it learns nothing about which routes
  exist.
* **`GET /healthz` is the one open route**, exactly that method and that path. An orchestrator's
  probe cannot send a token, and the route returns `{ status, server, version }` — nothing the
  set holds. The exemption is never looser than the route: `/healthz/x`, `POST /healthz` and
  `HEAD /healthz` are refused.
* **Never disclosed.** Not logged, not echoed in an error, not in a response; the refusal at
  startup states the length it found and never the value.
* **Not applied on loopback.** A bind on `127.0.0.1` does not waive the token. A reverse proxy
  on the same host would turn that waiver into an open public door, and "local" is not
  something a server can reliably infer from its bind address.

**What it does not do.**

* **One shared token.** Every client holds the same value. There is no per-client identity, no
  audit of who called, and no revoking one client without revoking all; the remedy is to
  rotate (change the variable, restart — the server is stateless, so nothing is dropped) and
  hand the new value out.
* **No TLS.** A bearer token over plain `http` is readable by anyone on the path. Terminate TLS
  in front of this process; it will not do it for you.
* **No rate limiting.** A caller can still guess at the token as fast as the network allows. A
  64-character hex token (`openssl rand -hex 32`) makes that a non-event; a rate limit in front
  makes it quieter. The 32-character floor keeps a weak value from being accepted at all.
* **No OAuth.** A client that can only authenticate through an OAuth flow cannot use a static
  token. Claude Code, a `.mcp.json` `headers` entry, the Agent SDK and the Inspector can send
  the header.

**The `Host` allow-list, and its default.** `MCP_ALLOWED_HOSTS` (comma-separated) turns on
hostname validation. **It is off unless set**, and the process says so on startup.

This default is worth distrusting, because the last implementation of this server had the
same shape and it was a live problem: `MCP_DNS_REBINDING_PROTECTION` defaulted to `false`,
so `originGuard`'s allow-lists did nothing at all — see
`.agents/memory/tasks/activation-security.md`. The same trap is reachable again here, and
narrower: the SDK's `createMcpExpressApp` applies protection automatically for loopback
hosts only, and **a container binds `0.0.0.0`**, which is the deployment this transport
exists to enable.

For a server on a routable interface, the exposure is DNS rebinding — a browser on
someone's machine resolving an attacker-controlled name to a local or internal address, and
issuing requests the victim's origin policy would otherwise block. The `Host` allow-list
is the mitigation. Setting it is one environment variable, and the test suite asserts that
it rejects a disallowed `Host` rather than assuming it does.

**Not included, deliberately.** No rate limiting and no TLS termination. Both belong to
whatever sits in front of the process, and each is a decision for whoever deploys this. TLS
matters more now than it did: the token travels in a header, and over plain `http` that header
is readable on the path.

**`/healthz` was in that list and is not any more.** This page previously argued for its
absence: *"a probe endpoint on a server that serves only public markdown is a route that
exists to be probed."* That argument was not refuted — it was met with consistency. The
four sibling servers already answer `GET /healthz`, and the reason a probe route is
objectionable here is the reason it is unremarkable there. What it answers is
`{ status, server, version }`, read before any request body, so it exposes nothing the set
does not and cannot be used to enumerate files. A deployment that needs a liveness probe
gets one, and a deployment that does not has not lost anything it had.

**There are no sessions.** The transport this replaced was stateful: it minted a session
that lived as long as the client's stream, and an unauthenticated public port with an
unbounded session map is a memory-growth primitive. `POST /mcp` mints nothing. Each request
carries everything it needs, builds its own `McpServer`, and is closed when its response
closes — so the memory-growth primitive this paragraph used to have a mitigation for is
gone rather than bounded, and the only thing a shutdown counts is what is running right
now. See *Attack surface* above, and the per-request row in it.

## No path is read from a caller

The server holds no function that takes caller-influenced input. The set is read once at boot
from a fixed directory, an instruction call is a map lookup, and nothing opens a file a caller named.

- **The guard is structural.** No tool takes a `path`, so a caller has nothing to traverse
  with. There used to be one path-taking read, reached by one tool with a constant path, and
  a check that ran before any filesystem call; both are gone.
- **A test pins it.** Every tool's schema has no properties and no required fields, so a tool
  that grows an argument has to be added deliberately, against that test.

If a future change adds any read keyed on caller input, that is the change to look at first.

## Authentication: HTTP only

stdio has none and needs none; HTTP on loopback needs none unless one is set; HTTP on any
other interface requires a bearer token. The reasoning, the construction and
the limits are in **The HTTP listener** above.

The token does not change what the content is. **Nothing confidential goes in `content/`, in
`wiki/`, or anywhere else in this repository.** Treat every file here as world-readable,
because it is — it is on npm, and in a checkout, whatever the deployed instance asks of its
callers. If a future change makes any served content non-public, a token on this server is not
the delivery mechanism for it: the text would still ship in the package. That change needs a
different one.

## Secrets

There is one: **`MCP_AUTH_TOKEN`**, the bearer token for the HTTP transport. This server reads
six environment variables, and the other five are not credentials:

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `3000` | The port to bind. A number. |
| `HOST` | `0.0.0.0` | The interface to bind. An address. A loopback address makes the token optional. |
| `MCP_ALLOWED_HOSTS` | unset | Hostnames permitted in the `Host` header. **Off when unset.** |
| `MCP_AUTH_TOKEN` | **none** | **A secret.** The bearer token every HTTP request except `GET /healthz` must carry. At least 32 characters; HTTP off loopback will not start without it; stdio never reads it. |
| `MCP_TRANSPORT` | `stdio` | Which transport `src/index.js` speaks. A word. |
| `MCP_CLUSTER_WORKERS` | CPU count | How many HTTP worker processes to fork. A number. |

The token is held by whoever deploys the service and by each client, and by nothing else. It
lives in the process environment, an `env_file`, or the host's secret store — never in
`content/`, a wiki page, a test fixture, a Dockerfile `ENV` line, a command line that lands in a
shell history, or a commit. It is never logged, echoed in an error, or put in a response; the
test suite asserts that neither the real token nor a rejected one reaches the output. The tests
use an obvious dummy and no real value exists in this repository.

A second variable that takes a secret is a decision, not an implementation detail: it widens
what a leaked environment gives away.

`.env` and `.env.*` are gitignored (`.env.example` deliberately is not). A real token never
goes in `.env.example`.

## Deployment posture

The server can be run two ways, and they have genuinely different exposure.

**stdio** — a client spawns the process and speaks JSON-RPC over a pipe. Exposure is
bounded by who can run the process at all. `npm start` and `npm run start:stdio` are the
same command, named for what it is.

**HTTP** — `npm run start:http` binds a port and serves the same tools, stateless, at
`POST /mcp`, with a `GET /healthz` beside it. Exposure is bounded by who can reach that
port **and** holds `MCP_AUTH_TOKEN`; off loopback the process will not start without one. It is designed to be deployed as a Web Service, and it is not deployed anywhere by
this repository: there is no host, no hostname, and no registry image, and the
documentation says "can be deployed" rather than "is deployed" for that reason.

**A `Dockerfile` exists and can do either.** The image pins the toolchain, installs from
the lockfile with `--ignore-scripts`, and ends as `USER node`. It declares `EXPOSE 3000`
and its default entrypoint is still the stdio server; the HTTP one is a command away:

```bash
docker run --rm -i lxagents-shared-instruction:6.0.3                     # stdio
docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-shared-instruction:6.0.3 \
  node src/http.js                                                        # HTTP, token required
```

A container here is both a way to run the server without Node 20 and, with that second
command, a network boundary — so it should now be described as one where it is one, and
the earlier claim that it could not be was true only while stdio was the whole interface.

Three properties of the image are load-bearing and are checked before committing it: the
install runs with lifecycle scripts disabled, the process is not root, and the exposed
port matches the one the server binds. Either of the first two dropped turns a pinned
non-root image into one that runs third-party install hooks as root.

**The image has still never been built.** Docker is not available in the environment these
changes were written in, so the `EXPOSE` and entrypoint changes are unverified by build.
That is recorded here rather than left to be assumed.

## Reporting something

Open an issue on `LXAgents-Skills/shared-instruction`. If the finding is about content that
would direct another repository's agent to do something harmful, say so in the title — it
is the class of bug that reaches furthest fastest, and it is fixed by a release rather
than a patch on one machine.
