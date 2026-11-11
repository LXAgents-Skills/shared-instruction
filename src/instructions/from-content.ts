import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CONTENT_DIR } from "../version.js";

/**
 * The prefix every tool id carries: `{org_name}_{repo_name}`, underscores only.
 *
 * A client that connects several LXAgents servers sees all their tools in one list, so a bare
 * `api` or `plan_creator` from two servers would collide. The prefix names the server a tool
 * comes from, and is the same for every tool here.
 */
export const TOOL_PREFIX = "lxagents_skills_shared_instruction";

/** A base name with the server prefix in front of it. */
export function toolId(base: string): string {
  return `${TOOL_PREFIX}_${base}`;
}

/**
 * Names that do not survive mechanical derivation.
 *
 * Everything else is named after its own filename, so adding a file to `content/`
 * adds the tool that serves it without anyone deciding what to call it. The
 * exceptions are the per-forge pages under `skills/github/` and `skills/gitlab/`:
 * the folder is dropped from the derived name, so `api`, `authentication`, `issues`
 * and `repositories` exist on both forges and would collide, and the rest (`ci`,
 * `actions`, `releases`) say nothing about which forge they belong to. Each is named
 * for its forge instead, matching the `name` in its own frontmatter. The values are base names;
 * `NAME_OVERRIDES` below adds the prefix.
 *
 * Keys are set-relative paths. A key that matches no file is a startup error, so a
 * rename cannot leave an override quietly matching nothing.
 */
const OVERRIDE_BASES: Readonly<Record<string, string>> = {
  "skills/github/actions.md": "github_actions",
  "skills/github/api.md": "github_api",
  "skills/github/authentication.md": "github_authentication",
  "skills/github/issues.md": "github_issues",
  "skills/github/pull-requests.md": "github_pull_requests",
  "skills/github/releases.md": "github_releases",
  "skills/github/repositories.md": "github_repositories",
  "skills/gitlab/api.md": "gitlab_api",
  "skills/gitlab/authentication.md": "gitlab_authentication",
  "skills/gitlab/ci.md": "gitlab_ci",
  "skills/gitlab/issues.md": "gitlab_issues",
  "skills/gitlab/merge-requests.md": "gitlab_merge_requests",
  "skills/gitlab/repositories.md": "gitlab_repositories",
};

/**
 * The overrides as full tool ids, keyed by set-relative path. The base names above are what
 * differs per file; the prefix is added here, once, so it cannot drift between entries.
 */
export const NAME_OVERRIDES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(OVERRIDE_BASES).map(([path, base]) => [path, toolId(base)])),
);

/** What a tool is registered under: its id and the description its file's frontmatter gives. */
export interface InstructionConfig {
  name: string;
  description: string;
}

/** One served file: how it is registered, and the handler that returns it whole. */
export interface InstructionTool {
  config: InstructionConfig;
  handler: () => Promise<CallToolResult>;
}

/** The single-line scalar fields of a file's frontmatter, by key. */
type Frontmatter = Record<string, string>;

/** The shape an MCP client will accept as a tool name. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,127}$/;

/**
 * Derive a tool name from a set-relative path.
 *
 * The folder is dropped and the server prefix added, so `git/branching-strategy.md` is
 * `lxagents_skills_shared_instruction_branching_strategy` rather than a path-qualified name.
 * The cost is that two folders holding the same filename would collide —
 * which `buildContentInstructions` treats as a startup error rather than letting the second
 * file silently shadow the first.
 */
function toolNameFor(relativePath: string): string {
  const override = NAME_OVERRIDES[relativePath];
  if (override) return override;

  const base = relativePath
    .split("/")
    .pop()!
    .replace(/\.md$/, "")
    .toLowerCase()
    .replace(/-/g, "_");
  return `${TOOL_PREFIX}_${base}`;
}

/** Every `.md` under the set root, as set-relative forward-slash paths, sorted. */
function markdownFiles(dir: string = CONTENT_DIR, base: string = CONTENT_DIR): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full, base));
    else if (entry.name.endsWith(".md")) {
      found.push(relative(base, full).split(sep).join("/"));
    }
  }

  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Pull `name` and `description` out of a file's frontmatter.
 *
 * Only single-line scalar fields are read. A folded YAML value would need a real
 * parser, and the alternative is a dependency added to serve one call site, which
 * `.agents/rules/repository.md` forbids. A field this misses is caught below as a
 * missing description rather than silently serving an empty one.
 *
 * The value is matched as `\S.*` rather than `.*`, so the run of spaces in front of
 * it and the value behind it are different character classes. Two overlapping
 * greedy runs in a row are what let a line that fails to match be retried from
 * every length; with `\S` in front, handing a space back can never turn a failure
 * into a match, so a non-matching line costs one pass instead of one pass per space.
 */
function parseFrontmatter(text: string): Frontmatter | null {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;

  const fields: Frontmatter = {};
  for (const line of block[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(\S.*|)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

/**
 * Build the whole per-file tool surface, reading the set once.
 *
 * Everything is resolved here, at import, so a malformed set fails the process
 * rather than surfacing as a wrong answer to the first caller that needed the file.
 * A handler is then a map lookup: there is no path argument, so there is nothing for
 * a caller to traverse with, and there is no filesystem I/O on the read path.
 *
 * The file is served whole, frontmatter included, byte-identical to what the set
 * holds — the frontmatter is part of the published text, not metadata to strip.
 */
function buildContentInstructions(): { tools: InstructionTool[]; files: Map<string, string> } {
  const tools: InstructionTool[] = [];
  const files = new Map<string, string>();
  const claimed = new Map<string, string>();
  const paths = markdownFiles();

  for (const key of Object.keys(NAME_OVERRIDES)) {
    if (!paths.includes(key)) {
      throw new Error(
        `NAME_OVERRIDES names ${key}, which is not in the set. Remove the override or restore the file.`,
      );
    }
  }

  for (const path of paths) {
    const name = toolNameFor(path);

    if (!TOOL_NAME.test(name)) {
      throw new Error(
        `${path} derives the tool name "${name}", which is not a valid MCP tool name. Add it to NAME_OVERRIDES.`,
      );
    }
    if (claimed.has(name)) {
      throw new Error(
        `${path} and ${claimed.get(name)} both derive the tool name "${name}". One would silently shadow the other; add one to NAME_OVERRIDES.`,
      );
    }
    claimed.set(name, path);

    const text = readFileSync(join(CONTENT_DIR, path), "utf8");
    const frontmatter = parseFrontmatter(text);

    if (!frontmatter?.description) {
      throw new Error(
        `${path} has no frontmatter \`description:\`. It would publish as a tool a client cannot route on.`,
      );
    }

    files.set(name, path);
    tools.push({
      config: { name, description: frontmatter.description },
      handler: async (): Promise<CallToolResult> => ({ content: [{ type: "text", text }] }),
    });
  }

  if (tools.length === 0) {
    throw new Error(`No markdown files under ${CONTENT_DIR}. This server would expose nothing.`);
  }

  return { tools, files };
}

const { tools, files } = buildContentInstructions();

export const CONTENT_INSTRUCTIONS: readonly InstructionTool[] = Object.freeze(tools);

/** Tool name -> the set-relative file it serves. The test suite pins both directions. */
export const INSTRUCTION_FILES: ReadonlyMap<string, string> = files;

export default CONTENT_INSTRUCTIONS;
