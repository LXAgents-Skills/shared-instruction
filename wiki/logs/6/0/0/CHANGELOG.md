# 6.0.0

**Released:** 2026-11-11

The repository moved to the `LXAgents-Skills` organization, and the server now describes what it
serves as **Skill MCP instructions**. The npm package is renamed from
`@lxagents-mcp/shared-instruction` to `@lxagents-skills/shared-instruction`, and the surface
builder moved from `src/tools/` to `src/instructions/`. **The wire surface is unchanged**: the
connector id is still `lxagents-shared-instruction`, the same tools return the same names, and
`tools/list` and `tools/call` behave as before. This is a major release because the old package
name no longer receives versions and a deep import of `src/tools/from-content.js` now fails.

**Consumers must:**

1. **Switch `npx` registrations to the new package:** `args: ["-y", "@lxagents-skills/shared-instruction"]`.
   The old name stays at `5.0.0`.
2. **Point clones and remotes at `https://github.com/LXAgents-Skills/shared-instruction`.**
3. **If you import the module directly**, use `src/instructions/from-content.js` and the new names:
   `CONTENT_INSTRUCTIONS`, `INSTRUCTION_FILES`, and `INSTRUCTION_MODULES` from `src/server.js`.
4. **Pull `lxagents-shared-instruction:6.0.0`** if you run the image.

**If you consume the connector by its id, you need to do nothing.** The id, every tool name, and
every tool's text in `content/` are as they were, apart from two sentences that named the old
organization.

## Changed

- **Organization and package.** `LXAgents-MCP` → `LXAgents-Skills` in `package.json`,
  `package-lock.json`, `README.md`, `AGENTS.md`, the wiki, the local rules, and two `content/`
  files. Earlier release logs and closed task records keep the old name, because they record what
  was true when they were written.
- **Code.** `src/tools/` → `src/instructions/`; `TOOL_MODULES` → `INSTRUCTION_MODULES`,
  `CONTENT_TOOLS` → `CONTENT_INSTRUCTIONS`, `TOOL_FILES` → `INSTRUCTION_FILES`,
  `buildContentTools` → `buildContentInstructions`. The MCP SDK calls (`registerTool`,
  `listTools()`) and the MCP tool-name check are unchanged.
- **Terminology.** "Skill MCP server" where the docs name this server; "shared instruction" and
  "instruction call" where they said "shared tool" and "tool call". The `initialize`
  instructions string and the HTTP startup line (`serving Skill MCP over http on …`) say Skill MCP.
  The protocol, the SDK, the MCP Inspector, and generic MCP-server guidance in `content/` keep
  "MCP".

Tests: 70, unchanged in number, all passing.
