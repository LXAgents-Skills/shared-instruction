import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTENT_DIR } from "../src/version.js";
import { NAME_OVERRIDES, INSTRUCTION_FILES } from "../src/instructions/from-content.js";
import { INSTRUCTION_MODULES, createServer } from "../src/server.js";

/** A client connected to a fresh server over an in-memory pipe. */
async function connect() {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  const server = createServer();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

/** The text of a single-content tool result. */
function textOf(result) {
  assert.equal(result.content.length, 1, "expected exactly one content block");
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

/** Every markdown file in the served set, as [path-relative-to-content, absolute]. */
async function markdownFiles(dir = CONTENT_DIR) {
  const found = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith(".md")) {
      found.push([relative(CONTENT_DIR, full).split(sep).join("/"), full]);
    }
  }

  return found.sort(([a], [b]) => a.localeCompare(b));
}

// The set's own conventions, before the tool surface is tested at all.

test("every served file declares name and description in its frontmatter", async () => {
  // Two fields, not four. The set carries no `version` or `author` in a file: the
  // release log is the record of what changed, and a per-file version is a second
  // place to forget to update. `description` is load-bearing: it is the tool
  // description, so a file without one is a tool a client cannot route on.
  for (const [path, full] of await markdownFiles()) {
    const text = await readFile(full, "utf8");
    const block = text.match(/^---\s*\n(.*?)\n---/s);

    assert.ok(block, `${path} has no frontmatter`);
    for (const field of ["name", "description"]) {
      assert.match(
        block[1],
        new RegExp(`^${field}:\\s*\\S`, "m"),
        `${path} is missing \`${field}:\` in its frontmatter`,
      );
    }
  }
});

// The tool surface. One file, one tool, and no argument anywhere.

test("the tool list and the files on disk are a bijection", async () => {
  // Both directions, because each catches a different mistake. Files-to-tools
  // catches a file that was added and never surfaced; tools-to-files catches a
  // tool serving something that is no longer in the set. Together they are what
  // makes "add a file, get a tool" a property rather than a hope.
  const files = (await markdownFiles()).map(([path]) => path);
  const served = [...INSTRUCTION_FILES.values()].sort((a, b) => a.localeCompare(b));

  assert.deepEqual(served, files);

  assert.equal(
    INSTRUCTION_FILES.size,
    files.length,
    "two files must not derive the same tool name",
  );
  assert.ok(files.length > 20, `expected a real set, found ${files.length} files`);
});

test("every tool name is derived from its own filename, or is an explicit override", () => {
  // The derivation is the design: a file's name is what a caller reads in the
  // tool list, so it has to survive the trip. Folder stripped, `.md` dropped,
  // kebab to snake. The overrides are the documented exceptions, and they are
  // checked here by path so an override cannot drift away from the file it names.
  for (const [name, path] of INSTRUCTION_FILES) {
    assert.match(name, /^[a-z][a-z0-9_]{0,63}$/, `${name} is not a usable tool name`);

    if (Object.hasOwn(NAME_OVERRIDES, path)) {
      assert.equal(name, NAME_OVERRIDES[path], `${path} must be named by its override`);
      continue;
    }

    const expected = path
      .split("/")
      .pop()
      .replace(/\.md$/, "")
      .toLowerCase()
      .replace(/-/g, "_");

    assert.equal(name, expected, `${path} derives ${name}, expected ${expected}`);
  }
});

test("every override names a file in the set", () => {
  // Boot already refuses a stale override; this keeps the property visible in the
  // suite, where a change to the boot check would otherwise go unnoticed.
  const paths = new Set(INSTRUCTION_FILES.values());

  for (const path of Object.keys(NAME_OVERRIDES)) {
    assert.ok(paths.has(path), `override ${path} matches no file`);
  }
});

test("forge pages are named for their forge", () => {
  // Four filename pairs exist on both forges (`api`, `authentication`, `issues`,
  // `repositories`), and the rest (`ci`, `actions`, `releases`) mean nothing without
  // one. A page under a forge folder must say which forge, in the tool name.
  for (const [name, path] of INSTRUCTION_FILES) {
    const forge = path.match(/^skills\/(github|gitlab)\//)?.[1];
    if (!forge) continue;

    assert.ok(
      name.startsWith(`${forge}_`),
      `${path} is a ${forge} page and must be named ${forge}_…, found ${name}`,
    );
  }
});

test("every tool has a distinct name and a description to route on", () => {
  const names = INSTRUCTION_MODULES.map(({ config }) => config.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");

  for (const { config } of INSTRUCTION_MODULES) {
    assert.ok(
      config.description && config.description.length > 0,
      `${config.name} needs a description`,
    );
  }
});

test("no tool takes an argument", async () => {
  // The structural claim, and the replacement for the traversal defence that the
  // old path-taking tool needed. With no argument there is nothing to traverse
  // with, so this is not a weaker version of the old check — it is the check.
  const { client } = await connect();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    assert.deepEqual(
      tool.inputSchema.properties ?? {},
      {},
      `${tool.name} must take no argument`,
    );
    assert.deepEqual(
      tool.inputSchema.required ?? [],
      [],
      `${tool.name} must require nothing`,
    );
  }
});

test("every tool returns its own file, whole and with frontmatter", async () => {
  const { client } = await connect();

  for (const [name, path] of INSTRUCTION_FILES) {
    const text = textOf(await client.callTool({ name, arguments: {} }));
    const onDisk = await readFile(join(CONTENT_DIR, path), "utf8");

    assert.equal(text, onDisk, `${name} must serve ${path} byte for byte`);

    // \r? because a checkout on Windows serves CRLF, and the bytes are served as
    // they are on disk.
    assert.match(text, /^---\r?\n/, `${name} must serve the frontmatter`);
    assert.ok(text.includes("name:"), `${name} must not strip the frontmatter`);
  }
});

test("the whole set is served and nothing is served twice", async () => {
  // Served twice would mean a file the set holds but a caller cannot reach by
  // name; served short would mean a file silently dropped from the surface.
  const { client } = await connect();

  let total = 0;
  for (const [name] of INSTRUCTION_FILES) {
    total += textOf(await client.callTool({ name, arguments: {} })).length;
  }

  let onDisk = 0;
  for (const [, full] of await markdownFiles()) {
    onDisk += (await readFile(full, "utf8")).length;
  }

  assert.equal(total, onDisk, "the tools must serve exactly the files on disk");
});

test("the whole set is reachable by tool name", async () => {
  // A file in content/ that nothing routes to is the failure that prompted the
  // router work, so reachability is asserted per file rather than assumed.
  // The name comes from the map, not from re-deriving it here: a test that
  // repeats the derivation cannot catch a mistake in the derivation.
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const byPath = new Map([...INSTRUCTION_FILES].map(([name, path]) => [path, name]));

  for (const path of [
    "creators/plan-creator.md",
    "git/branching-strategy.md",
    "rules/versioning.md",
    "skills/github/api.md",
  ]) {
    const name = byPath.get(path);

    assert.ok(name, `${path} must have a tool`);
    assert.ok(names.has(name), `${path} must be reachable as ${name}`);
  }
});

test("every tool is generated from a file", async () => {
  // There is no hand-written tool: a tool the generator did not build is a tool no
  // file backs, and it would serve text the set does not hold.
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [...INSTRUCTION_FILES.keys()].sort());
});

// The hub. `automation` is read in every session, so it is the one tool whose size is a recurring
// cost, and the one tool allowed to name the others. These tests keep it total (every tool is
// routed), honest (no tool that does not exist), and small.

const HUB_NAME = "Read this tool every session";
const HUB_BUDGET = 10_000;

/** The `- \`id\` — condition` rows of the hub. */
function hubRows(text) {
  return [...text.matchAll(/^- `([a-z][a-z0-9_]*)` — (.+)$/gm)].map((m) => ({
    id: m[1],
    condition: m[2],
  }));
}

test("automation is the first tool, and says it is read every session", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();

  assert.equal(tools[0].name, "automation", "the hub must be the first tool a client lists");
  assert.ok(
    tools[0].description.startsWith(HUB_NAME),
    `the description must open with "${HUB_NAME}", found: ${tools[0].description.slice(0, 60)}`,
  );

  const text = textOf(await client.callTool({ name: "automation", arguments: {} }));
  assert.match(text, new RegExp(`^---\\r?\\nname: ${HUB_NAME}\\r?\\n`));
});

test("automation routes every other tool exactly once, and no tool that does not exist", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const text = textOf(await client.callTool({ name: "automation", arguments: {} }));

  const rows = hubRows(text);
  const listed = rows.map((row) => row.id);
  const expected = tools.map((tool) => tool.name).filter((name) => name !== "automation");

  assert.deepEqual([...listed].sort(), [...expected].sort());
  assert.equal(new Set(listed).size, listed.length, "a tool is listed twice");

  for (const { id, condition } of rows) {
    assert.ok(
      condition.length >= 20 && condition.length <= 200,
      `${id} needs a condition a reader can match against a request, found ${condition.length} chars`,
    );
  }
});

test("automation stays small enough to read every session", async () => {
  const { client } = await connect();
  const text = textOf(await client.callTool({ name: "automation", arguments: {} }));

  assert.ok(
    text.length <= HUB_BUDGET,
    `automation is ${text.length} characters; the budget is ${HUB_BUDGET}. It is paid for in every session.`,
  );
});

test("the server's own instructions send a session to automation first", async () => {
  const { client } = await connect();
  const instructions = client.getInstructions() ?? "";

  assert.match(instructions, /`automation`/);
  assert.match(instructions, /every session/);
  assert.doesNotMatch(instructions, /Call nothing at session start/);
});

// Each tool ends in itself. A tool is read on its own, by a session that has not read any other,
// so a pointer to another tool is a pointer to text the reader does not have. The detector
// below is deliberately about links, filenames and ids, not about prose: single words such as
// `api` or `issues` are ordinary English, so only the forms that can only mean a file are matched.

/** Anthropic's own skills happen to share names with two tools here. They are facts, not pointers. */
const EXTERNAL_NAMES = {
  "skills/reference/anthropic-agent-skills.md": ["skill-creator", "skill_creator", "mcp-builder", "mcp_builder"],
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every pointer from `file` to a different tool, as [line, kind, what]. */
function pointersFrom(file, tools) {
  const hits = [];
  const allowed = new Set(EXTERNAL_NAMES[file.path] ?? []);

  file.text.split("\n").forEach((line, index) => {
    const at = index + 1;

    for (const match of line.matchAll(/\]\(([^)]*)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target) || target.includes("{")) continue;
      hits.push([at, "link", target]);
    }

    for (const other of tools) {
      if (other.path === file.path) continue;

      const sameName = other.stem === file.stem; // github/api.md and gitlab/api.md
      // A root-level file has no folder, so its path without `.md` is one ordinary word.
      const pathless = other.path.includes("/") ? other.path.replace(/\.md$/, "") : null;
      if (
        !sameName &&
        (new RegExp(`(?<![\\w-])${escapeRegExp(other.stem)}\\.md\\b`).test(line) ||
          (pathless !== null && line.includes(pathless)))
      ) {
        hits.push([at, "path", other.path]);
      }

      // A stem is only an id when no override renames it: `pull-requests` is a GitHub API
      // word, `github_pull_requests` is the tool.
      const words = new Set(
        [other.overridden ? other.name : other.stem, other.frontmatterName].filter((word) =>
          /[-_]/.test(word),
        ),
      );
      for (const word of [...words]) {
        words.add(word.replaceAll("-", "_"));
        words.add(word.replaceAll("_", "-"));
      }
      for (const word of words) {
        if (word === file.stem || word === file.frontmatterName || allowed.has(word)) continue;
        if (new RegExp(`(?<![\\w-])${escapeRegExp(word)}(?![\\w-])`).test(line)) {
          hits.push([at, "name", word]);
        }
      }
    }
  });

  return hits;
}

test("every tool except automation ends in itself", async () => {
  const tools = [];
  for (const [name, path] of INSTRUCTION_FILES) {
    const text = await readFile(join(CONTENT_DIR, path), "utf8");
    tools.push({
      name,
      path,
      text,
      stem: path.split("/").pop().replace(/\.md$/, ""),
      overridden: Object.hasOwn(NAME_OVERRIDES, path),
      frontmatterName: text.match(/^name:\s*(\S.*)$/m)?.[1].trim() ?? "",
    });
  }

  const problems = [];
  for (const tool of tools) {
    if (tool.name === "automation") continue; // the hub is the one tool that routes to the others
    for (const [line, kind, what] of pointersFrom(tool, tools)) {
      problems.push(`${tool.path}:${line} points at ${what} (${kind})`);
    }
  }

  assert.deepEqual(
    problems,
    [],
    `a tool must not link to, name, or send the reader to another tool:\n${problems.join("\n")}`,
  );
});

// The release branch form. A typo guard, not a control: it proves each tool that names
// branches states the form, not that an agent obeys it.

test("every tool that names branches states the release branch form", async () => {
  const { client } = await connect();

  for (const name of ["plan_creator", "branching_strategy", "branch_and_commit"]) {
    const text = textOf(await client.callTool({ name, arguments: {} }));

    assert.ok(
      text.includes("release/{version}"),
      `${name} names branches and must state release/{version}`,
    );
    // The bad-examples table in branching_strategy names `release/v1.0.0` on purpose.
    const prose = text
      .split("\n")
      .filter((line) => !line.startsWith("| `release/v"))
      .join("\n");

    assert.doesNotMatch(
      prose,
      /release\/v\d|release\/v\{version\}/,
      `${name} must not put a v in the release branch; the git tag carries it`,
    );
  }
});

test("no tool shows the retired chore/release branch form", async () => {
  const { client } = await connect();

  for (const [name] of INSTRUCTION_FILES) {
    const text = textOf(await client.callTool({ name, arguments: {} }));

    // branching_strategy lists it once, as a bad example, so it is allowed to name it.
    if (name === "branching_strategy") continue;

    assert.doesNotMatch(text, /chore\/release/, `${name} still shows chore/release`);
  }
});

// The read-only claim, now over a surface with no arguments at all.

test("the surface is read-only: no tool takes a verb", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    const properties = Object.keys(tool.inputSchema.properties ?? {});
    for (const name of ["action", "verb", "operation", "command", "body", "content"]) {
      assert.equal(
        properties.includes(name),
        false,
        `${tool.name} must not accept ${name}`,
      );
    }
  }
});

test("the surface is read-only: no tool takes a credential", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    const properties = Object.keys(tool.inputSchema.properties ?? {});
    for (const name of ["apiKey", "api_key", "token", "secret", "password"]) {
      assert.equal(
        properties.includes(name),
        false,
        `${tool.name} must not accept ${name}`,
      );
    }
  }
});

test("the server needs no key to answer", async () => {
  delete process.env.API_KEY;

  const { client } = await connect();
  const text = textOf(
    await client.callTool({ name: "plan_creator", arguments: {} }),
  );

  assert.ok(text.length > 500, "the set is served without a key");
});

test("INSTRUCTION_MODULES is the whole surface, and every module is well formed", () => {
  assert.equal(INSTRUCTION_MODULES.length, INSTRUCTION_FILES.size);

  for (const { config, handler } of INSTRUCTION_MODULES) {
    assert.equal(typeof config.name, "string");
    assert.ok(config.description.length > 0, `${config.name} needs a description`);
    assert.equal(typeof handler, "function");
  }
});

test("no tool module can write to the set", async () => {
  // The structural claim: the served surface is a read. If a tool ever grows a
  // write path, this is the test that has to be made to fail on purpose.
  const { client } = await connect();
  const { tools } = await client.listTools();

  assert.equal(tools.length, INSTRUCTION_FILES.size);
  assert.ok(
    CONTENT_DIR.endsWith("content"),
    "the set root is content/, and every read is resolved inside it",
  );
});
