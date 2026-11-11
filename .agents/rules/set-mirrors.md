---
name: set-mirrors
description: Every place in this repository that reproduces published set text outside content/ — the mirror list, and the same-commit obligation.
---

# Set Mirrors

`content/` is the product, but this repository holds copies of its text outside it. A
change to the set that misses one does not just leave a stale page: it ships a
contradiction, because both copies are read as instructions.

This rule is local. Only a repository that **produces** the shared set can hold a mirror
of it — a consuming repository copies no shared file, because a copy outlives the rule it
copies. This is the producer's version of the copy problem.

## The mirrors

| Mirror | What it reproduces |
|---|---|
| [`AGENTS.md`](../../AGENTS.md) (repository root) | The **Shared instruction tools** declaration block (the `lxagents_skills_shared_instruction_automation` row and the six conventions it names); the inline gates; and the *Using the connector* section — the read sequence, the transport, and the unavailable-connector obligation. The trigger table for the rest of the set is **not** copied: [`content/automation.md`](../../content/automation.md) is the one authority for when each tool fires. This repository consumes its own set, so its entry point goes stale exactly like a consumer's. |
| [`src/server.js`](../../src/server.js) | The `instructions` string restates the routing model — read `lxagents_skills_shared_instruction_automation` once per session, call nothing else until its condition is true, one file per tool — in the text every client receives at `initialize`. A client that reads only that gets the model without the set. |

The discovery-protocol block has its own bounded copy list, owned by
[`content/rules/discovery-protocol.md`](../../content/rules/discovery-protocol.md) §F. It is
deliberately listed there rather than here, because it duplicates a *block*, not a model.
This table covers everything that list does not.

## Not a mirror

[`src/instructions/from-content.js`](../../src/instructions/from-content.js) reads `content/` and
derives each tool from the file it serves — the name from the path, the description from
the file's own frontmatter. It restates nothing, which is why it cannot drift from the set
and needs no entry in the table above. **Prefer that shape.** New code that needs set text
reads it from `content/`; hard-coding is what puts a file in the table.

## The obligation

A change to [`content/automation.md`](../../content/automation.md),
to `shared-instructions.md` §D, to the routing model, or to any text a mirror reproduces
updates every affected mirror **in the same commit** — the rule
[`content/rules/change-propagation.md`](../../content/rules/change-propagation.md)
applies to documentation, extended to the source and prompt copies nothing else covers.

Before committing a change under `content/`, grep for a distinctive sentence you
changed. If it appears outside `content/`, it is a mirror and it is in scope.

**Adding a file to `content/` is not this obligation.** A new file becomes a tool on the
next boot, with its name and description read from itself — there is no tool list, no
registry, and no source file to edit. Adding one is a one-file change. Renaming or
deleting a file *is* a breaking change to the tool surface, so it needs the mirrors updated
and a major version.

## Why this exists

The `0.8.0` request named four files to edit. Three more carried the same text and would
have shipped the old count — one into every repository set up from a setup prompt since removed, one into every `AGENTS.md` a scaffolding tool wrote, and one into the string every
client sees at `initialize`. Nothing written down would have caught it.

The scaffolding tool is gone, and with it the worst mirror in the table: for a while the
same block was written into every new repository from two directions at once. The
remaining three are all files a human opens deliberately, which is a much smaller blast
radius — but they are still mirrors, and this is the list that says so.
