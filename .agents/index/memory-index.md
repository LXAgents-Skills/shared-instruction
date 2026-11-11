---
name: memory-index
description: Index of this repository's memory — current state and task records. Read every session.
---

# Memory Index

**Scope:** `.agents/memory/`
**Parent:** [`root-index.md`](root-index.md)

Read this every session and load only the rows whose scope matches the request, so you
continue prior work instead of restarting it. Every memory file is registered here in
the same commit that creates it.

## state/

| File | Purpose |
|---|---|
| [`../memory/state/repository-state.md`](../memory/state/repository-state.md) | Current known state: what exists, what is deployed, what is not built yet. |

## decisions/

| File | Purpose |
|---|---|
| [`../memory/decisions/express-for-http-transport.md`](../memory/decisions/express-for-http-transport.md) | Why `express` became the third runtime dependency, for the HTTP transport. |
| [`../memory/decisions/delete-branch-on-stacked-merge.md`](../memory/decisions/delete-branch-on-stacked-merge.md) | Why a stacked chain is merged with branch deletion on — three pull requests reported MERGED while `master` had none of the work. |
| [`../memory/decisions/http-bearer-token.md`](../memory/decisions/http-bearer-token.md) | Why the HTTP transport requires a bearer token and refuses to start without one, when the set had no authentication by design. |

## findings/

| File | Purpose |
|---|---|
| [`../memory/findings/workflow-merge-findings.md`](../memory/findings/workflow-merge-findings.md) | Three instruction findings raised by the `3.0.0` merge and never applied — the stale version field, the merge gate restated seven times, and the gates the set never states as a list. |

## tasks/

| File | Purpose |
|---|---|
| [`../memory/tasks/local-agents-set.md`](../memory/tasks/local-agents-set.md) | Separating this repository's own instruction set from the published `content/`. |
| [`../memory/tasks/change-propagation-rule.md`](../memory/tasks/change-propagation-rule.md) | Adding the change-propagation rule and hardening no-session-links; the `0.3.0` release. |
| [`../memory/tasks/work-summary-rule.md`](../memory/tasks/work-summary-rule.md) | Adding the work-summary rule and closing two audit gaps found on real consumers; the `0.4.0` release. |
| [`../memory/tasks/dual-purpose-and-workflow.md`](../memory/tasks/dual-purpose-and-workflow.md) | Repository URL migration, the always-on workflow mandate, the dual-purpose CLI, and `mcp-creator`; the `0.5.0` and `0.6.0` releases. |
| [`../memory/tasks/discovery-protocol-always-on.md`](../memory/tasks/discovery-protocol-always-on.md) | Promoting `discovery-protocol.md` from a trigger row to a mandatory standard file; the `0.8.0` release. |
| [`../memory/tasks/task-record.md`](../memory/tasks/task-record.md) | Making the task record task 1 of every request, with each task appending its own entry; the `0.9.0` release. |
| [`../memory/tasks/mcp-install.md`](../memory/tasks/mcp-install.md) | The §F retarget rule, and a wiki guide for running this repository as a local MCP server from `./mcps/`. |
| [`../memory/tasks/sonarcloud-quality-security.md`](../memory/tasks/sonarcloud-quality-security.md) | Clearing the SonarCloud findings in both repositories — path traversal, three super-linear regexes, an implicit sort, Docker install hooks, and a CLI refactor. |
| [`../memory/tasks/shared-instructions-agent-urls.md`](../memory/tasks/shared-instructions-agent-urls.md) | Narrowing the two-sets table in `shared-instructions.md` to address the shared set as `agents://` only; the `0.10.1` release. |
| [`../memory/tasks/npm-install-before-test.md`](../memory/tasks/npm-install-before-test.md) | Adding the npm-install-before-npm-test rule, after a fresh checkout made an uninstalled tree look like broken code. |
| [`../memory/tasks/model-naming-convention-tools.md`](../memory/tasks/model-naming-convention-tools.md) | Publishing the `{platform}/{model}` naming convention and the two read-only tools that serve it; the `0.11.0` release. |
| [`../memory/tasks/agents-auto-activation-tool.md`](../memory/tasks/agents-auto-activation-tool.md) | One read-only tool that activates a session in a single call: the activation rule, the four mandatory files, and the routing table. |
| [`../memory/tasks/claude-md-import.md`](../memory/tasks/claude-md-import.md) | Adding `.claude/CLAUDE.md` as an import of the root `AGENTS.md`, so Claude Code and every other agent read one file. |
| [`../memory/tasks/activation-inlining-audit.md`](../memory/tasks/activation-inlining-audit.md) | Auditing whether `agents_auto_activation` still inlines `planning/task-workflow.md`, and closing the test gap that let the question stay open. |
| [`../memory/tasks/activation-security.md`](../memory/tasks/activation-security.md) | Making plan approval a third permission gate, defining the workflow-fallback recovery, and adding this repository's own security context. |
| [`../memory/tasks/security-creator.md`](../memory/tasks/security-creator.md) | Publishing `security/` as a real instruction folder, and the `security-creator` that fixes the shape of every security file. |
| [`../memory/tasks/declared-tool-surface.md`](../memory/tasks/declared-tool-surface.md) | Replacing the one-call activation tool with per-convention tools each repository declares in its own `AGENTS.md`; the `1.0.0` release. |
| [`../memory/tasks/per-file-tools.md`](../memory/tasks/per-file-tools.md) | Replacing the single path-taking instruction tool with one generated tool per content file, across all four instruction MCP servers; the `2.0.0` release. |
| [`../memory/tasks/feat-http-transport.md`](../memory/tasks/feat-http-transport.md) | Adding an HTTP/SSE transport alongside stdio so the server can run as a Web Service, and correcting every page that claimed there was no listener. **Superseded** by [`sse-to-mcp-transport.md`](sse-to-mcp-transport.md), and left on disk as the record of why it was SSE. |
| [`../memory/tasks/fix-sonar-issues.md`](../memory/tasks/fix-sonar-issues.md) | Clearing the two remaining SonarCloud findings — a super-linear frontmatter regex, and Express framework version disclosure. |
| [`../memory/tasks/merge-workflow.md`](../memory/tasks/merge-workflow.md) | Merging `planning/task-workflow.md` into `creators/plan-creator.md` and deleting the original — the tool-surface break, the retired `planning/` folder, and the `3.0.0` release. |
| [`../memory/tasks/sse-to-mcp-transport.md`](../memory/tasks/sse-to-mcp-transport.md) | Replacing the SSE transport at `/sse` and `/message` with a stateless `POST /mcp`, plus cluster workers. Breaking for deployed SSE clients, and the prior decision is superseded rather than erased. |
| [`../memory/tasks/auto-activation-and-github-guide.md`](../memory/tasks/auto-activation-and-github-guide.md) | Completing the `auto_activation` routing table to every published tool, and publishing the GitHub token guide as a tool; the `3.1.0` release. |
| [`../memory/tasks/mcp-list-selection-gate.md`](../memory/tasks/mcp-list-selection-gate.md) | Making `mcp_list` report the whole server list, ask the user to select, and ask again before cloning — plus the three publishing organisations; the `3.2.0` release. |
| [`../memory/tasks/connector-registration-and-pr-merge.md`](../memory/tasks/connector-registration-and-pr-merge.md) | Registering the deployed connector through `.mcp.json`, landing the `.gitignore` change on `#92` rather than a new branch, and merging `#92` and `#93` by local merge commit because the merge API 404s for every method. |
| [`../memory/tasks/replace-tool-contents.md`](../memory/tasks/replace-tool-contents.md) | Replacing every published tool with the owner's re-created set, self-contained tools, the `automation` hub, the `release/{version}` branch form; the `4.0.0` release. |
| [`../memory/tasks/http-token-auth.md`](../memory/tasks/http-token-auth.md) | Requiring a bearer token on the HTTP transport while stdio stays open, and the breaking release that follows. |
| [`../memory/tasks/skill-mcp-migration.md`](../memory/tasks/skill-mcp-migration.md) | Moving to the LXAgents-Skills organization and the Skill MCP instruction vocabulary, with the MCP SDK surface intact. |
| [`../memory/tasks/code-optimization.md`](../memory/tasks/code-optimization.md) | The 6.0.1 cleanup: the HTTP test suite split by subject and one JSON-RPC error helper. |
