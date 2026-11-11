# Overview

`LXAgents-Skills/shared-instruction` is a Skill MCP server that delivers the organization's
shared agent instruction set. It is published as `@lxagents-skills/shared-instruction`, and the Skill MCP
connector it serves is named `lxagents-shared-instruction` — the package name and the connector
id are deliberately different, because renaming the id would break every consuming
repository's client configuration.

## The problem it solves

An agent working in a repository needs to know the organization's conventions: how
branches are named, what a commit message looks like, what belongs in a pull request
body, where a new file goes. Those conventions are identical across repositories, so
writing them into each one produces N copies of the same rules.

Copies drift. A fix lands in one repository and not the others; nothing signals that a
copy has fallen behind; and because a local file takes precedence over a shared one,
the stale copy is the one that wins.

The usual answer is a shared `.agents` repository that each consumer clones as a
sibling. That removes the copies but adds a checkout: something to clone, keep current,
and accidentally commit.

## The answer here

Serve the set instead. A repository adds one connector and reads the rules it needs at
the moment it needs them. There is no checkout, so there is nothing to sync and nothing
to vendor by mistake, and every repository reads the same bytes.

## What it serves

**Tools, and nothing else.** One per markdown file in `content/`, all generated. No
prompts, no resources. Reachable over stdio or stateless HTTP at
`POST /mcp`; both serve the same tools, because both call the same `createServer()`.

| Tool | Serves |
|---|---|
| `lxagents_skills_shared_instruction_automation` | `automation.md` — read it first, every session; it lists every other tool and the condition that activates each. |
| `lxagents_skills_shared_instruction_plan_creator` | `creators/plan-creator.md` |
| `lxagents_skills_shared_instruction_branching_strategy` | `git/branching-strategy.md` |
| `lxagents_skills_shared_instruction_commit_conventions` | `git/commit-conventions.md` |
| `lxagents_skills_shared_instruction_discovery_protocol` | `rules/discovery-protocol.md` |
| …and one tool for every other file | Named after its own filename; the GitHub and GitLab pages are named for their forge. |

The complete list is whatever the client enumerates from `tools/list`. It is deliberately
not written out here: a hand-maintained copy of a generated list is a copy that goes stale.

**No tool takes an argument.** Each one names a single file, so there is no path to pass
and nothing for a caller to traverse with. Every tool is read-only.

## Why the tools, and not prompts

A tool makes an instruction set something the model *may decide* to call, and a session
sees the full list — name and description — before deciding anything. That is what lets a
repository route on a description without reading a body.

A session reads **one** tool at the start, `lxagents_skills_shared_instruction_automation`, which lists every other tool and the
condition that activates it. Each of the others fires only when its condition is true, and
each is complete on its own — none points to another. A session that only branches and
commits pays for the hub and two files rather than the whole set — which is the entire point
of the current design, and the reason this page does not describe a single bulk call.

## Related pages

- [Architecture](architecture.md) — how the tool surface is generated, and why that makes
  concurrency and read cost a non-issue.
- [Skill MCP surface](../reference/mcp-surface.md) — the generated tools, and the longer list of
  what this server does not expose.
- [Connect a repository](../guides/connect-a-repository.md) — adoption, step by step.
