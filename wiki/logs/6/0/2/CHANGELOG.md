# 6.0.2

**Released:** 2026-11-11

Every tool id now starts with the server's prefix, `lxagents_skills_shared_instruction_`, so a client
that connects several LXAgents servers can never see two tools with the same id. Ids use underscores
only. **This renames every tool.** It ships as a patch because the owner chose that, but a consumer
that calls a tool by its old id gets "tool not found" until it switches.

**Consumers must:**

1. **Rename every tool you call or declare.** For example, `automation` →
   `lxagents_skills_shared_instruction_automation`, `plan_creator` →
   `lxagents_skills_shared_instruction_plan_creator`, and `github_api` →
   `lxagents_skills_shared_instruction_github_api`. The rest of the set follows the same pattern. This
   applies to the `AGENTS.md` declaration block, the trigger rows, and any override keyed on an old id.
2. **Start every session at `lxagents_skills_shared_instruction_automation`.** It lists every other
   tool under its new id.
3. **Restart open sessions** so the client reloads the tool list.

The text each tool returns is unchanged, except in `automation`, whose ids are now prefixed.

## Changed

- **`src/instructions/from-content.js`** has two new exports. `TOOL_PREFIX` is
  `lxagents_skills_shared_instruction`, and `toolId(base)` builds `${TOOL_PREFIX}_${base}`.
  - Derived names are prefixed.
  - Overrides are kept as base names and exported prefixed in `NAME_OVERRIDES`.
  - `TOOL_NAME` allows up to 128 characters (`{0,127}`). The longest id is 60 characters, which stays
    under the 64-character limit many clients enforce.
- **`content/automation.md`** keeps its frontmatter and all 47 rows, now under the prefixed ids, and
  is still under its size budget.
- **The `initialize` instructions string** names the prefixed hub.
- **`AGENTS.md`, `README.md`, the wiki and the local rules** use the prefixed ids.
- **Tests** check that every id has the prefix and contains no hyphens. Four HTTP tests that read a
  worker's trailing startup line without waiting for it now wait.

Tests: 70, all passing on six consecutive runs.
