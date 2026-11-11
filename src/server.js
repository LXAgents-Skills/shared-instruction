import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONTENT_INSTRUCTIONS } from "./instructions/from-content.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * Every tool this server exposes.
 *
 * One per file in `content/`, built by `instructions/from-content.js`. A tool registered
 * anywhere else is invisible to `listTools()`, to the client's `tools/list`, and to
 * the test suite. This array is the whole surface — there is no discovery, and no
 * way to add a tool at runtime.
 *
 * Nothing here takes an argument, which is the point: there is no `path` for a
 * caller to traverse with, and no verb for a caller to act on. The tools that write
 * the set are absent, not disabled, so pointing a repository at this server cannot
 * mutate it.
 */
const INSTRUCTION_MODULES = [...CONTENT_INSTRUCTIONS];

/**
 * Build the MCP server.
 *
 * @returns {McpServer}
 */
export function createServer() {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      instructions:
        "The LXAgents shared agent instruction set, served as Skill MCP instructions, read-only. Read the `lxagents_skills_shared_instruction_automation` tool once at the start of every session: it lists every tool and the condition that activates each. Call no other tool until its condition is true. Each tool is complete on its own and points to no other.",
    },
  );

  for (const { config, handler } of INSTRUCTION_MODULES) {
    server.registerTool(
      config.name,
      { description: config.description, inputSchema: config.schema },
      handler,
    );
  }

  return server;
}

export { INSTRUCTION_MODULES };
