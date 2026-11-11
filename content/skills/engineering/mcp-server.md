---
name: mcp-server
description: What this workspace does when it is handed an MCP server — the server is recorded as a page under .agents/skills/ and never installed or cloned. Read when handed an MCP server, a plugin, or a skill, and when a registered connector resolves no tools.
---

# MCP Server

**This page is about an MCP server arriving in this workspace, not about building one.**
The build side — transports, the handshake, tool declarations, testing — is a different
subject and is not covered here. They used to be one file, which is why this page now opens by saying which question it answers.

## The rule: record it, never install it

**If you are handed an MCP server, a skill, a plugin, a marketplace, or a clone of one, you
do not add it to this workspace. You write it down** at

```
.agents/skills/{type}/{file-name}.md
```

Six types, chosen by what the capability *is*: `document/`, `visual-design/`,
`engineering/`, `authoring/`, `guidance/`, `reference/`.

The procedure: pick the type by what the capability *is*, name the file for its subject,
write the page, and check nothing was installed. The prohibition is absolute — nothing
handed over is installed, cloned, or vendored.

**Why:** a checkout at this root cannot be versioned — the root is not a git repository — so
it drifts with no diff to show it and no way back. It pulls in a dependency tree and a build
system this workspace has no use for. And it changes what an agent does here from outside the
instruction set, which is the one thing the instruction set exists to make auditable. A page
gives the same knowledge, reviewable and editable.

**The boundary is provenance, not usefulness.** A project you built in `orgs/{org}/{repo}/`
or `Personal/{project}/` is a project and belongs there. What is forbidden is a capability
sourced from outside this workspace being brought into the root.

**If the owner wants the repo itself,** hand them the clone command to run on the host,
outside this workspace's root. Do not run it here.

**Recording a capability is not installing it.** The rule above governs what comes *in*; a
tool authored here is the opposite case. **Copying someone else's script into
`.agents/tools/` is still forbidden** — write your own, or record what theirs does as a skill.

## What a page about an MCP server records

The capability knowledge: what the server exposes, how it authenticates, which endpoints are worth calling, and what
its failure modes are. Not the server itself.

Two things belong on separate pages rather than inside one, because they are different
subjects: **how MCP works** (a protocol fact), and
**how this workspace treats an MCP server that turns up in it** (this page).

## The three-state connector diagnosis

Handing this workspace a server is one half of the problem. The other half is a server that
was already registered somewhere and is contributing nothing to the session you are working
in. That failure is invisible from inside the server, and it is worth its own account.

**A health check answers reachability, not tool publication.** A client loads its connectors
at session start, so a server added mid-session can be registered, named, enumerated, and
reported connected by the client that owns the connection list — and still contribute **no
tools** to the session you are working in. Nothing in the health response distinguishes "up"
from "up and publishing nothing," and a declaration block that lists tool *names* makes the
failure invisible: the names are right, so a session reconstructs a tool body from memory
without noticing it is improvising.

So when a connector resolves nothing, there are three states, and they are not one:

| State | What you see | Cause | Fixed by |
|---|---|---|---|
| **Not registered** | No entry in the client's connector list | Never added | Register it, then restart the session |
| **Registered, wrong transport** | `404` from the old `GET /sse` / `POST /message` pair | Client registered `"type": "sse"` against a server that no longer serves it | Re-register with `"type": "http"` |
| **Registered, healthy, no tools** | The client reports it connected, and none of its tools are in your tool list | The client enumerated the server and did not publish the tools it serves | **Nothing, in-session** |

**Say the third one may not be fixable before restarting.** The first state's remedy is a
restart, so a session that misreads state three keeps retrying a cure that cannot work. And
never lower the bar to match — a tool that cannot be called is a different failure from a
tool that is absent, and only the first is a bug in the server.

## A note on history, because it explains the rule

This workspace's instruction set began as a copy of a set served over MCP by
`lxagents-shared-instruction`. The copy is now authoritative and the server is gone. That
worked out — but it is not a model to repeat, which is why the copy was worth knowing about
from the start, and why a server arriving here is a page rather than a dependency.

Two clones used to sit at the root: `anthropics/skills/` and
`LXAgents-Skills/shared-instruction/`. Both are gone or unused, and neither should come back.