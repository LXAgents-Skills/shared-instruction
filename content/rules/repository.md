---
name: repository-rules
description: Rules specific to this workspace — the non-repo root, the Proxy Rule, the folder layout, the never-install rule, and what must not be introduced here.
---

# Repository Rules

Rules that are true of **this** workspace only.

## Mode

This workspace is **standalone, permanently**.

The instruction set lives at `.agents/` and is authoritative. It began as a copy of a
shared set served over MCP; that server is gone, and the copy is now the original. There
is nothing to resolve, no `agents://` scheme, and no upgrade path to one. This is not a
deployment mode to be migrated away from.

Consequences to keep in mind:

* **The files under `.agents/` are yours to edit.** The old rule — do not improve them
  locally, a change belongs upstream — is withdrawn. It was right while an upstream
  existed and would have rejected the change; it would now freeze the set against every
  future correction with nowhere to send it. The quality bars still apply: a *missing* rule is proposed to the owner,
  and a rule file carries `name` and `description` frontmatter and covers one subject.
* **There is no migration procedure.** The old steps — delete `git/`, `prompts/`,
  `creators/`, `planning/` and the shared `rules/` files, then install a connector
  bootstrap block — described a destination that no longer exists. Executing them would
  delete the instruction set. They are gone deliberately.
* **The five files that described the old distribution model were merged into
  one wiki history page and deleted on 2026-10-04** — 1201 lines carrying the connector's tool surface, the
  three-state toolless diagnosis, and the duplicate-audit technique. That page is history:
  nothing routes to it for permission.
* **The root is not a git repository, so these files have no version history.** Read
  before overwriting, and prefer a targeted edit to a rewrite when unsure.

## The root is the repository — and has no `.git`

**The root is the repository. It is the workspace itself: the thing that owns the
instruction set, holds the projects, and is the unit everything else is measured against.**
It has no `.git` folder, and never will — so it is **not a git repository**, and that is a
deliberate property of the architecture rather than something missing.

**The two words mean different things here, and conflating them is what breaks a check.**

| "Repository" means | At the root | In a project folder |
|---|---|---|
| **The unit that owns a set of files** — the workspace, or one project | **Yes. This is it.** | Yes, that project |
| **A directory with a `.git` folder** — versioned history | **No, and never** | Yes, once the owner makes it one |

So a check that asks *"is this a repository?"* **has its answer at the root — yes**, and
must not then look for `.git/`, a HEAD, an origin, or a commit count. **A check whose answer
is "yes" and which then fails on a missing `.git` is the defect**, not the root. This is the
error that produced health checks that reported a clean tree as broken.

**What follows for git, and what does not.** Never run `git init`, `git commit -a`, or
`git clean` here: git would resolve to a **parent** directory rather than failing cleanly,
so the command lands somewhere nobody intended. Every git command runs from inside a project
folder. The `git/` conventions in `.agents/git/` apply there, not here.

Three practical effects at this level:

* No branch, no commit, and no push. So the plan's `git check-ignore` check on
  `.agents/plans/` is **unsatisfiable rather than unmet** — it fails with
  `fatal: not a git repository` — and the git steps of a plan are skipped, not failed.
* `wiki/logs/` does not exist: no version, no release history.
* **`AGENTS.md` may be edited directly. Nothing protects it** — so read before overwriting,
  and prefer a targeted edit to a rewrite. There is no diff and no rollback here.

The root is not on GitHub or GitLab and never will be. **That is about the remote, not about
the ownership** — the 86 organization folders under `.agents/wiki/{org}/` *are* published
elsewhere, and each README carries both forge URLs.

## The Proxy Rule

`server.py` is **shared infrastructure**: the single proxy between Claude Desktop,
headless Claude Code, and OpenRouter. Both clients depend on it, so changes break things
that look unrelated.

It is no longer frozen. The original Iron Rule ("never edit `server.py`") was lifted on
2026-10-04, when `extract_auth_key` and the `/v1/*` route aliases were added so headless
Claude Code could use it too.

What replaced it:

* **Say what you're changing and why before you change it.** No drive-by refactors.
* It serves **two** clients with different contracts. Claude Desktop uses `/api/v1/*` and
  sends `Authorization: Bearer`. Claude Code (`claude -p`) uses `/v1/*` and sends
  `x-api-key` with no `Authorization` at all. **Don't collapse one into the other** —
  that is the exact bug that blocked the webhook bridge.
* **The tests that would pin this do not exist.** They were to be
  `tests/test_server_proxy.py` in the bridge project, covering both paths and both auth
  styles; `Personal/` is empty, so that project does not exist. Until they are written,
  **every edit here is verified by hand** — one `/api/v1/*` request with a Bearer token,
  one `/v1/*` with an `x-api-key` header.
* **Keep the Thai comments.** They explain intent the code alone doesn't.

## Folder layout

```
<root>/
  AGENTS.md      entry point + activation contract
  CLAUDE.md      imports AGENTS.md, for Claude Code
  README.md      human overview
  server.py      the shared proxy
  .agents/       instructions, indexes, agent wiki, skills, plans
  wiki/          human documentation
  orgs/{org}/{repo}/  hosted project, one git repo each
  Personal/{project}/  un-hosted, local-only
```

The platform is **not** encoded in the path — the same `{org}` namespace exists on
github.com and gitlab.com, and a repo name is never reused across the two. Infer the
platform from the git remote, never from the folder name.

* Clone inside `orgs/{org}/` so the repo lands at `orgs/{org}/{repo}/`, deriving both
  names from the remote URL. If `orgs/{org}/{repo}/` already exists, stop and check for
  uncommitted work rather than cloning over it.
* A project folder is not a git repository until it is one — the root never is.
* Don't reorganize the top-level layout. Moving a project between `Personal/` and
  `orgs/{org}/` is the user's decision, not a cleanup step.

## No file names a location outside itself

**A path in a `.md` file is either relative to that file's own folder, or written `<root>`
— and `<root>` is defined here, once, as "the folder holding `AGENTS.md`."**

Nothing else. No absolute path, no home directory, no drive letter, no machine's folder
name. Write it that way rather than restating the definition, because
twenty-one references that each spelled out a folder name is how the folder name became
load-bearing in the first place.

**Why.** This workspace is meant to be copied somewhere else. `.agents/`, `AGENTS.md`,
`CLAUDE.md`, `README.md`, and `server.py` together work on any machine, under any folder
name, at any depth — **provided no file tells the reader where it was written.** A file
that says `MyProjects/` when the folder is called `work/` teaches the reader that these
files came from somewhere else, and they stop trusting the rest of it.

**The two failures are not equally loud**, which is why this is a rule rather than a
preference. A hardcoded path in a *command* breaks visibly — you get an error. A hardcoded
path in *prose* breaks silently: nothing fails, and a reader on another machine simply
concludes the setup is wrong. The silent one is the dangerous one, and it is the reason the
rule is not "avoid absolute paths in commands."

**This is one-file-one-scope applied to paths.** A file holds what belongs to its own
`name` — and a machine's layout belongs to no file. Same argument, same result.

**The accepted exceptions**, so the rule is not mistaken for absolute:

* `server.py` binding `127.0.0.1` — a network address, not a location on disk.
* A URL.
* A path inside a quoted example, where it is explicitly labelled as *this machine's* and is
  marked as an example — `wiki/guides/local-setup.md` is the one file that carries a real
  path, and it is a command a person runs by hand.

**When a command needs a directory**, do not hardcode one. Say "the folder holding
`AGENTS.md`", which resolves wherever the reader is.

## What must not be introduced here

* **No git repository at the root.** See above.
* **No generated output at the root — except `__pycache__/`, which is permitted.**
  Virtual environments, build output, and caches live inside the project that produces
  them. **`__pycache__/` is the one exception**, permitted by the owner on 2026-10-04: the
  root's only runnable code is `server.py`, and Python writes its bytecode cache beside the
  module it compiles. It is never committed — the root is not a repository — and it is not a
  precedent for a `.venv/`, `node_modules/`, or build output, which are still forbidden.
  Stated with its reasoning in the root
  `AGENTS.md` §Conventions.
* **No `INDEX.md` anywhere.** Indexes live in `.agents/index/{scope}-index.md`.
* **No third documentation tree.** `wiki/` and `.agents/wiki/` are the only two.
  `.agents/skills/` records things that live outside this workspace and is not a
  documentation tree about it.
* **No new root file.** The four root files are the whole set; anything else is a page in
  `wiki/`.
* **No loose file at the root of `.agents/`, `wiki/`, `.agents/wiki/`, or
  `.agents/plans/`.** Every page lives inside a folder. Inside a *project*,
  `.agents/memory/` joins that list — this root has no memory tree at all.
* **No third-party repository, and no installed capability of any kind.** See below.

## This workspace runs on plain files

**Everything here is a `.md` file on disk.** The instruction set, the plans, the task
records, the capability pages — all of it is text a person could read and edit with any
editor. **No MCP server serves any of it. No plugin supplies any of it. No marketplace
distributes it.** Nothing here is fetched at runtime, and nothing here can be out of date
because something upstream moved.

That is the premise, not a limitation to work around. It means the whole instruction set is
readable in one sitting, diffable by eye, and editable with the tools already on the machine.
The rule below is the consequence: if something *cannot* be a page here, it does not belong
here at all.

## The never-install rule

**If you are handed the contents of an MCP server, a skill, a plugin, or a marketplace —
or a clone of one — you do not add it to this workspace. You write it down.**

| What you were given | What you do instead |
|---|---|
| An MCP server (repo, zip, or pasted source) | Describe it in `.agents/skills/{type}/{file-name}.md` |
| A skill — one `SKILL.md`, or a skills repository | Describe it in `.agents/skills/{type}/{file-name}.md` |
| A plugin or plugin marketplace | Describe it in `.agents/skills/{type}/{file-name}.md` |
| A clone already sitting in the workspace | Delete it, then record it as above |

The record is one page per capability, under `.agents/skills/{type}/`, named for what it
describes.

**Why.** A checkout at a non-git root cannot be versioned, so it drifts silently and
cannot be rolled back. It drags in a build system, a dependency tree, and a license
position this workspace never took on. And installing a capability changes what an agent
does here, permanently, from outside the instruction set that is supposed to be
auditable — a file nobody reviewed decides behaviour. Writing it down gives the same
knowledge with none of those costs: the record is a page, it is reviewable, it is
editable, and if the upstream changes you can update one paragraph instead of a
tree.

**The boundary is not "is it useful".** It is *where it comes from*. Something you built
in `orgs/{org}/{repo}/` or `Personal/{project}/` is a project, and it belongs there — that
folder is a real repository and can hold dependencies. What is forbidden is a
capability sourced from outside this workspace being brought into the root.

**Already gone, and not coming back.** `anthropics/skills/` and
`LXAgents-Skills/shared-instruction/` were both cloned here, and both were deleted on
2026-10-04. If you need either, clone it elsewhere on your machine — outside this
workspace's root — and work there.

**What still exists.** Skills you already have installed at the *user* level, in Claude
Code's own plugin configuration, are none of this rule's business. They are not in this
workspace and this rule does not reach them. It governs what enters the workspace, not
what you already have.

## What copies to another machine

Copy `.agents/` and the four root files. **Do not copy `wiki/`.**

`wiki/` is the human documentation for one workspace on one machine: it names that
machine's paths, and two people running the same system want different documents of it.
`.agents/` is the opposite case — it is the thing that must read identically everywhere,
or two PCs hold two instruction sets that disagree about how work gets done.

| Travels | Stays |
|---|---|
| `.agents/` — rules, indexes, creators, skills, agent wiki | `wiki/` — human documentation, written per machine |
| `AGENTS.md`, `CLAUDE.md`, `README.md` | `.agents/plans/` — in flight, and about one machine's work |
| `server.py` | any project under `Personal/` or `orgs/{org}/{repo}/` |

**A rule that reaches into `wiki/` is fine; a rule that lives there is not.** `.agents/`
links out to `wiki/` for facts it does not own — 16 such links, across 8 files — and those
resolve only where a `wiki/` exists. The dependency runs one way, and that one-wayness is
what makes the copy sound: the instruction set never depends on a document that was not
carried.

**Therefore the project-wiki index stays.** It
routes into a tree that is not copied, so on a machine that has not written one yet those
rows resolve to nothing — which the file now says outright. Deleting the index instead
would orphan five links and leave the human tree unreachable on any machine, which is the
opposite of what this rule is for.

## Working agreements

* **Scope every task to exactly one project folder**, and say which one you are in before
  starting. The root is not code — there is nothing to build or test at the top level.
* **The agent sandbox has no outbound network.** npm, PyPI, and generic HTTPS all return
  403 through the proxy. Do not plan work that needs an install inside the sandbox; hand
  the user a command to run on the host instead.
* Never write a session link into any file, commit message, branch name, or comment.