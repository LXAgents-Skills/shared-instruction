---
name: security-boundaries
description: The security SOP for this repository — the isolation rule that keeps repositories from sharing a security context, and the checks each surface needs.
---

# Security Boundaries

The agent-facing half of this repository's security posture. The facts — attack surface,
deployment, what is and is not a secret — live once, in
[`../../../wiki/security/security-model.md`](../../../wiki/security/security-model.md).
Read that first. This page carries only what an agent must *do*, and the one rule that
exists because agents work across repositories and people mostly do not.

## A. The isolation rule

**A security context belongs to exactly one repository. Never carry one across.**

This is not a style preference. Security conclusions are the ones that look most
transferable and travel worst: "the path check is handled upstream", "auth is enforced at
the gateway", "that input is already validated", "secrets come from the vault here". Each
of those may be true where you learned it and false here, and the failure mode is silent —
you skip a check because you remember it being unnecessary somewhere else.

In practice, in a session that touches more than one repository:

* **State which repository a security claim is about, every time.** An unqualified claim
  is the one that migrates.
* **Never apply a mitigation from another repository without re-deriving it here.** The
  guard may belong somewhere else in this codebase, or be unnecessary, or be insufficient.
* **Never copy a threat model, a checklist, or a security page between repositories.** If
  the content is genuinely universal it is a shared-set proposal under
  [`discovery-protocol.md`](../../../content/rules/discovery-protocol.md), not a copy —
  and copies are what
  [`directories.md`](../../../content/rules/directories.md) forbids anyway.
* **Never assume this repository's posture applies outward.** This one has no
  authentication on stdio, one bearer token on HTTP, and nothing in its content that is
  confidential, *by design*. Carrying "there is nothing to protect here" into a repository
  that holds credentials is the worst version of this mistake, and it is the easy one to
  make, because it feels like context rather than a claim.

The trigger row in [`AGENTS.md`](../../../AGENTS.md) loads this page on security,
authentication, and deployment work so the rule is in front of you *before* the reasoning
that would violate it, not after.

## B. Before you change these, check this

| About to touch… | Verify before committing |
|---|---|
| Anything under `content/` | It cannot direct another repository's agent to run a command, weaken a convention, or skip a permission gate. This is the highest-reach change in the repository — see the trust boundary in the human page. |
| A tool's shape in `src/instructions/from-content.js` | It still takes **no argument**. A path parameter is the single change that would reopen traversal, and it is the one to argue against hardest. |
| The read path | No filesystem or network I/O was introduced. Reads are in-memory lookups, and that is what stops a read being steered at the disk. |
| `Dockerfile` | `--ignore-scripts` survives, the runtime stage still ends as `USER node`, and any `EXPOSE` still matches the port the entrypoint actually binds. Either of the first two dropped turns a pinned, non-root image into one that runs install hooks as root. |
| `src/http.js`, or anything touching a transport | `MCP_ALLOWED_HOSTS` still defaults to unset rather than to a permissive list, sessions are still deleted when their stream closes, and no `McpServer` is shared between them. HTTP still refuses to start without `MCP_AUTH_TOKEN`, and stdio still never reads it. |
| `src/auth.js`, or the middleware order in `src/app.js` | The check still runs after the `Host` allow-list and before the body parser and every route; the comparison is still constant-time; `GET /healthz` is still the only exemption and still exact; there is still no query-string form, no opt-out flag and no loopback waiver; and the token still never reaches a log line, an error or a response. A test pins each of these, and each was shown to fail when its control was removed. |
| A new dependency | It is genuinely needed — [`../../rules/repository.md`](../../rules/repository.md) names the three in the runtime tree and requires a recorded decision for a fourth. Each one is transitive attack surface. |
| Any config default | Loosening a default is a posture change affecting every consumer, not a convenience. Raise it rather than take it. |

## C. What to escalate rather than decide

Ask the user; do not resolve these on your own initiative.

* **A client configured with a URL that this server did not expect to serve.** An earlier
  revision of this page listed that case under *What is **not** a security finding here*,
  on the grounds that no HTTP transport existed and a URL pointed at nothing. That is no
  longer true, and leaving the entry would have told you to **dismiss** the first thing
  worth investigating whenever a connector is misconfigured — an anti-detection rule
  rather than a convenience. A URL that reaches an unexpected endpoint, a client pointed
  at someone else's host, or a connector that resolves where you did not configure it is
  now a finding: stop and say so.
* **Making any served content non-public.** The bearer token gates who may use a deployed
  instance, not the text: the set is on npm and in every checkout, so a key on this server
  does not make a byte of it confidential. That change needs a different delivery mechanism,
  and it is bigger than it looks. The HTTP transport made it a live question rather than a
  structural impossibility.
* **Any way to run HTTP without the token.** An opt-out flag, a variable that disables the
  check, a loopback exemption, a second route outside the middleware, or widening the
  `/healthz` exemption. The fail-closed start is the control; each of these is a hole shaped
  like a convenience.
* **Deploying the HTTP transport on a routable interface without `MCP_ALLOWED_HOSTS`.** The
  allow-list is off unless set, and the previous implementation's equivalent guard also
  defaulted to off — see `activation-security.md`. Turning it on is the decision; taking
  it on is a posture change affecting every deployment.
* **Loosening a guard to make something work** — adding a `path` argument to a tool,
  or relaxing a boot-time throw to get past a failing
  checkout. The guard is the feature; a test that needs it off is a test to rewrite.
* **A finding in content already published.** It reaches every consumer on their next
  read, so the fix is a release with an explicit *Consumers must* line, and
  [`versioning.md`](../../../content/rules/versioning.md) gates the version.
* **Anything that would put a credential in this repository.** There are none in it:
  `MCP_AUTH_TOKEN` lives in the deployer's environment and nowhere here. A second secret
  variable, or any real token in a file, a fixture or a commit, is a decision and not an
  edit.

## D. What is not a security finding here

Named because each one has cost a round of investigation before:

* **A registered server that reports healthy but has no tools.** The client loads its
  connector list at session start, so a server added mid-session is absent until the
  session restarts. A stale session, not a broken or hijacked server.
* **The process exiting at boot with a frontmatter or name-collision error.** Failing at
  boot is the design: the alternative is serving a set that is quietly wrong. The message
  names the file and the invariant it broke.
* **An edit to `content/` not appearing in a running server.** The set is read once at
  boot. Restart, do not go looking for a cache to invalidate.
* **stdio having no token.** Deliberate: the client spawns the process on its own machine,
  so the only caller is whoever already runs it. Re-raising it as a vulnerability is not a
  finding. Asking for one token for both transports is a design change to argue, not a gap.
* **`GET /healthz` answering without a token.** Deliberate and exact: an orchestrator's probe
  cannot send one, and the route returns only `{ status, server, version }`.
* **Every client sharing one token.** Known and stated in the human page: no per-client
  identity, rotate to revoke. Not a finding; a request for per-client tokens is a feature.
