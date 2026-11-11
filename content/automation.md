---
name: Read this tool every session
description: Read this tool every session, first — it lists every tool and the one condition that activates each, so you load only what the request needs.
---

# Automation

Read this once, at the start of every session. It is the only tool you read unprompted.

* Call no other tool yet. Match each step of the request against the conditions below, and
  call a tool only when its condition is true, and only that tool.
* Never call a tool "just in case". Each tool is complete on its own and points to none
  other, so one call gives you everything that tool has.
* Several conditions can be true at once. Call them in the order the work reaches them, not
  all at the start. Do not read a tool again unless its text has left your context.
* If a tool named here is not in your tool list, say so in your first message and work
  from what you have. Never rebuild a missing tool from memory.
* `lxagents_skills_shared_instruction_plan_creator`, `lxagents_skills_shared_instruction_branching_strategy`, `lxagents_skills_shared_instruction_commit_conventions` and `lxagents_skills_shared_instruction_discovery_protocol` are
  the four every repository must declare. Their conditions are not optional.

## Every session that will change something

- `lxagents_skills_shared_instruction_shared_instructions` — the request will write a file, commit, or change state: it holds the three permission gates (plan, pull request, merge).
- `lxagents_skills_shared_instruction_code_optimization` — the request will write, move or review code, in any language: one responsibility per unit, and the audit when asked to optimize or refactor.

## Planning and working

- `lxagents_skills_shared_instruction_plan_creator` — the request is more than one step; before any file is written or branch created.
- `lxagents_skills_shared_instruction_branch_and_commit` — you are about to run the whole branch, commit, push, pull request loop as one procedure.
- `lxagents_skills_shared_instruction_discovery_protocol` — you notice a rule that should exist, or are about to add one to an instruction file.
- `lxagents_skills_shared_instruction_change_propagation` — you changed code or structure that a document describes.
- `lxagents_skills_shared_instruction_memory_creator` — you record progress, a decision, or session state under `.agents/memory/`.
- `lxagents_skills_shared_instruction_memory_policy` — you decide what may go into memory, and what never does.
- `lxagents_skills_shared_instruction_work_summary` — you are about to report finished work back to the user.
- `lxagents_skills_shared_instruction_gate_enforcement` — you document a permission gate, or judge whether it is a mechanism or only the reader's compliance.

## Git and releases

- `lxagents_skills_shared_instruction_branching_strategy` — before you create, name, or stack a branch, including `release/{version}`.
- `lxagents_skills_shared_instruction_commit_conventions` — before you write a commit message.
- `lxagents_skills_shared_instruction_pull_request_template` — before you open or edit a pull request title or body.
- `lxagents_skills_shared_instruction_no_session_links` — before you write anything that will be committed or posted: commit, branch, tag, pull request, comment, file.
- `lxagents_skills_shared_instruction_versioning` — before you touch anything that carries a version number, or when a change might deserve a bump.
- `lxagents_skills_shared_instruction_changelog_creator` — you record a release under `wiki/logs/{Major}/{Minor}/{Patch}/`.
- `lxagents_skills_shared_instruction_github_token_access_guide` — `gh` or `git` fails with 403 or "not accessible by integration", or before a first write to GitHub from a Codespace.
- `lxagents_skills_shared_instruction_model_naming_convention` — before you store a model identifier, in any `model_name` column.

## Writing instructions and documentation

- `lxagents_skills_shared_instruction_instruction_creator` — you write or change a rule or an instruction file.
- `lxagents_skills_shared_instruction_information_creator` — you write documentation, in either wiki.
- `lxagents_skills_shared_instruction_technical_writing` — before you write or review any documentation page.
- `lxagents_skills_shared_instruction_index_creator` — you write an index, or add, move, rename or delete a file an index lists.
- `lxagents_skills_shared_instruction_security_creator` — you write or change a security file: a policy, a threat model, a security procedure.
- `lxagents_skills_shared_instruction_directories` — you decide where a new file or folder goes, or which wiki a page belongs in.
- `lxagents_skills_shared_instruction_repository` — you work at the workspace root, or need to know what must not be introduced there.
- `lxagents_skills_shared_instruction_skill_creator` — you are handed an MCP server, skill, plugin, marketplace or clone, or asked to record how an external tool works.

## MCP and skills

- `lxagents_skills_shared_instruction_mcp_builder` — you write or review an MCP server.
- `lxagents_skills_shared_instruction_mcp_server` — you are handed an MCP server, plugin or skill, or a registered connector resolves no tools.
- `lxagents_skills_shared_instruction_anthropic_agent_skills` — you write or review a `SKILL.md`.

## Documents and design

- `lxagents_skills_shared_instruction_docx` — a task reads, produces or edits a `.docx`.
- `lxagents_skills_shared_instruction_pdf` — a task reads, produces, merges, splits or fills a `.pdf`.
- `lxagents_skills_shared_instruction_xlsx` — a task reads, produces or edits a `.xlsx`.
- `lxagents_skills_shared_instruction_web_interface` — before you build or review any UI.
- `lxagents_skills_shared_instruction_code_review` — before you review a change or ask for one.

## GitHub

- `lxagents_skills_shared_instruction_github_authentication` — before any `gh` or GitHub API call.
- `lxagents_skills_shared_instruction_github_pull_requests` — you create, read, review or merge a pull request with `gh`.
- `lxagents_skills_shared_instruction_github_issues` — you create, search or manage issues and labels with `gh`.
- `lxagents_skills_shared_instruction_github_repositories` — you inspect or change repository settings, branch protection or collaborators.
- `lxagents_skills_shared_instruction_github_actions` — you read or trigger workflow runs, or ask whether checks make a pull request mergeable.
- `lxagents_skills_shared_instruction_github_releases` — you cut or inspect a release, tag, draft or prerelease.
- `lxagents_skills_shared_instruction_github_api` — you need an endpoint `gh` does not wrap, through `gh api`.

## GitLab

- `lxagents_skills_shared_instruction_gitlab_authentication` — before any `glab` or GitLab API call.
- `lxagents_skills_shared_instruction_gitlab_merge_requests` — you create, review or merge a merge request.
- `lxagents_skills_shared_instruction_gitlab_issues` — you work with issues, epics, boards, weight or iterations.
- `lxagents_skills_shared_instruction_gitlab_repositories` — you inspect or change a project or group, its visibility, permissions or protected branches.
- `lxagents_skills_shared_instruction_gitlab_ci` — you read or fix a pipeline, a job, or `.gitlab-ci.yml`.
- `lxagents_skills_shared_instruction_gitlab_api` — you need an endpoint `glab` does not wrap, through `glab api` or `curl`.
- `lxagents_skills_shared_instruction_git_hosting_common` — you work across GitHub and GitLab, or a word such as review request or pipeline means different things on the two.
