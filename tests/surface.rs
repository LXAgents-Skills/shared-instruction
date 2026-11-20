//! The tool surface: one file, one tool, no argument anywhere, and the hub that routes them.
//!
//! The set's own conventions are checked against the files on disk; the surface is checked
//! through the real binary over a real stdio pipe, because that is what a client reads.

mod common;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;

use common::{StdioClient, content_dir, expected_tools};
use lxagents_shared_instruction::instructions::{
    InstructionSet, OVERRIDE_BASES, TOOL_PREFIX, markdown_files, name_override, tool_id,
};

const HUB_NAME: &str = "Read this tool every session";
const HUB_BUDGET: usize = 10_000;

fn hub() -> String {
    tool_id("automation")
}

fn set() -> InstructionSet {
    InstructionSet::load(&content_dir()).unwrap()
}

fn on_disk(path: &str) -> String {
    fs::read_to_string(content_dir().join(path)).unwrap()
}

// The set's own conventions.

#[test]
fn every_served_file_declares_name_and_description_in_its_frontmatter() {
    for path in markdown_files(&content_dir()).unwrap() {
        let text = on_disk(&path);
        let body = text
            .strip_prefix("---")
            .unwrap_or_else(|| panic!("{path} has no frontmatter"));
        let block = &body[..body
            .find("\n---")
            .unwrap_or_else(|| panic!("{path} has no frontmatter"))];
        for field in ["name", "description"] {
            let declared = block.lines().any(|line| {
                line.strip_prefix(field)
                    .and_then(|rest| rest.strip_prefix(':'))
                    .is_some_and(|value| !value.trim().is_empty())
            });
            assert!(declared, "{path} is missing `{field}:` in its frontmatter");
        }
    }
}

// The tool surface.

#[test]
fn the_tool_list_and_the_files_on_disk_are_a_bijection() {
    let files = markdown_files(&content_dir()).unwrap();
    let set = set();
    let served: Vec<String> = set.tools().iter().map(|tool| tool.path.clone()).collect();
    assert_eq!(served, files);
    let names: HashSet<&str> = set.tools().iter().map(|tool| tool.name.as_str()).collect();
    assert_eq!(
        names.len(),
        files.len(),
        "two files must not derive the same tool name"
    );
    assert!(
        files.len() > 20,
        "expected a real set, found {} files",
        files.len()
    );
}

#[test]
fn every_tool_name_is_derived_from_its_own_filename_or_is_an_explicit_override() {
    for tool in set().tools() {
        let name = &tool.name;
        assert!(
            name.starts_with(&format!("{TOOL_PREFIX}_")),
            "{name} must carry the prefix"
        );
        assert!(!name.contains('-'), "{name} must use underscores only");
        assert!(
            name.len() <= 128 && name.chars().next().unwrap().is_ascii_lowercase(),
            "{name} is not usable"
        );
        if let Some(overridden) = name_override(&tool.path) {
            assert_eq!(
                *name, overridden,
                "{} must be named by its override",
                tool.path
            );
            continue;
        }
        let file = tool.path.rsplit('/').next().unwrap();
        let expected = tool_id(
            &file
                .trim_end_matches(".md")
                .to_lowercase()
                .replace('-', "_"),
        );
        assert_eq!(*name, expected, "{} derives {name}", tool.path);
    }
}

#[test]
fn every_override_names_a_file_in_the_set() {
    let paths: HashSet<String> = set().tools().iter().map(|tool| tool.path.clone()).collect();
    for (path, _) in OVERRIDE_BASES {
        assert!(paths.contains(*path), "override {path} matches no file");
    }
}

#[test]
fn forge_pages_are_named_for_their_forge() {
    for tool in set().tools() {
        for forge in ["github", "gitlab"] {
            if tool.path.starts_with(&format!("skills/{forge}/")) {
                assert!(
                    tool.name.starts_with(&tool_id(&format!("{forge}_"))),
                    "{} is a {forge} page, named {}",
                    tool.path,
                    tool.name
                );
            }
        }
    }
}

#[test]
fn every_tool_has_a_distinct_name_and_a_description_to_route_on() {
    let set = set();
    let names: HashSet<&str> = set.tools().iter().map(|tool| tool.name.as_str()).collect();
    assert_eq!(names.len(), set.len(), "tool names must be unique");
    for tool in set.tools() {
        assert!(
            !tool.description.is_empty(),
            "{} needs a description",
            tool.name
        );
    }
}

#[test]
fn no_tool_takes_an_argument_a_verb_or_a_credential() {
    let mut client = StdioClient::main();
    for tool in client.tools() {
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object", "{tool}");
        let properties = schema["properties"]
            .as_object()
            .map_or(0, |properties| properties.len());
        assert_eq!(properties, 0, "{} must take no argument", tool["name"]);
        assert!(
            schema["required"]
                .as_array()
                .is_none_or(|required| required.is_empty()),
            "{} must require nothing",
            tool["name"]
        );
    }
}

#[test]
fn every_tool_returns_its_own_file_whole_and_with_frontmatter() {
    let mut client = StdioClient::main();
    let mut served = 0;
    for tool in set().tools() {
        let text = client.text(&tool.name);
        assert_eq!(
            text,
            on_disk(&tool.path),
            "{} must serve {} byte for byte",
            tool.name,
            tool.path
        );
        assert!(
            text.starts_with("---\n") || text.starts_with("---\r\n"),
            "{} must serve the frontmatter",
            tool.name
        );
        assert!(
            text.contains("name:"),
            "{} must not strip the frontmatter",
            tool.name
        );
        served += text.len();
    }
    let total: usize = markdown_files(&content_dir())
        .unwrap()
        .iter()
        .map(|path| on_disk(path).len())
        .sum();
    assert_eq!(
        served, total,
        "the tools must serve exactly the files on disk"
    );
}

#[test]
fn every_tool_is_generated_from_a_file_and_reachable_by_name() {
    let mut client = StdioClient::main();
    let listed: BTreeSet<String> = client
        .tools()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_string())
        .collect();
    let generated: BTreeSet<String> = set().tools().iter().map(|tool| tool.name.clone()).collect();
    assert_eq!(listed, generated);
    assert_eq!(listed.len(), expected_tools());

    let by_path: HashMap<String, String> = set()
        .tools()
        .iter()
        .map(|tool| (tool.path.clone(), tool.name.clone()))
        .collect();
    for path in [
        "creators/plan-creator.md",
        "git/branching-strategy.md",
        "rules/versioning.md",
        "skills/github/api.md",
    ] {
        let name = by_path
            .get(path)
            .unwrap_or_else(|| panic!("{path} must have a tool"));
        assert!(listed.contains(name), "{path} must be reachable as {name}");
    }
}

#[test]
fn an_unknown_tool_is_an_error_not_a_file() {
    let mut client = StdioClient::main();
    let response = client.call(
        "tools/call",
        serde_json::json!({ "name": tool_id("nope"), "arguments": {} }),
    );
    assert_eq!(response["error"]["code"], -32602, "{response}");
}

// The hub.

/// The `- \`id\` — condition` rows of the hub.
fn hub_rows(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("- `")?;
            let (id, condition) = rest.split_once("` — ")?;
            let id_ok = id.chars().next()?.is_ascii_lowercase()
                && id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            (id_ok && !condition.is_empty()).then(|| (id.to_string(), condition.to_string()))
        })
        .collect()
}

#[test]
fn automation_is_the_first_tool_and_says_it_is_read_every_session() {
    let mut client = StdioClient::main();
    let tools = client.tools();
    assert_eq!(
        tools[0]["name"],
        hub(),
        "the hub must be the first tool a client lists"
    );
    assert!(
        tools[0]["description"]
            .as_str()
            .unwrap()
            .starts_with(HUB_NAME)
    );
    let text = client.text(&hub());
    assert!(
        text.starts_with(&format!("---\nname: {HUB_NAME}\n"))
            || text.starts_with(&format!("---\r\nname: {HUB_NAME}\r\n"))
    );
}

#[test]
fn automation_routes_every_other_tool_exactly_once_and_no_tool_that_does_not_exist() {
    let mut client = StdioClient::main();
    let rows = hub_rows(&client.text(&hub()));
    let listed: Vec<&str> = rows.iter().map(|(id, _)| id.as_str()).collect();
    let unique: BTreeSet<&str> = listed.iter().copied().collect();
    assert_eq!(unique.len(), listed.len(), "a tool is listed twice");

    let expected: BTreeSet<String> = set()
        .tools()
        .iter()
        .map(|tool| tool.name.clone())
        .filter(|name| *name != hub())
        .collect();
    assert_eq!(
        unique
            .into_iter()
            .map(String::from)
            .collect::<BTreeSet<_>>(),
        expected
    );

    for (id, condition) in &rows {
        let length = condition.chars().count();
        assert!(
            (20..=200).contains(&length),
            "{id} needs a condition a reader can match, found {length} chars"
        );
    }
}

#[test]
fn automation_stays_small_enough_to_read_every_session() {
    let mut client = StdioClient::main();
    let length = client.text(&hub()).chars().count();
    assert!(
        length <= HUB_BUDGET,
        "automation is {length} characters; the budget is {HUB_BUDGET}"
    );
}

#[test]
fn the_servers_own_instructions_send_a_session_to_automation_first() {
    let client = StdioClient::main();
    assert!(client.instructions.contains(&format!("`{}`", hub())));
    assert!(client.instructions.contains("every session"));
    assert!(
        !client
            .instructions
            .contains("Call nothing at session start")
    );
}

// Each tool ends in itself: no link, filename or id that can only mean another tool.

struct ToolFile {
    name: String,
    base: String,
    path: String,
    text: String,
    stem: String,
    overridden: bool,
    frontmatter_name: String,
}

/// Anthropic's own skills share names with two tools here. They are facts, not pointers.
const EXTERNAL_NAMES: &[(&str, &[&str])] = &[(
    "skills/reference/anthropic-agent-skills.md",
    &[
        "skill-creator",
        "skill_creator",
        "mcp-builder",
        "mcp_builder",
    ],
)];

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Whether `line` holds `word` with no word character or hyphen on either side.
fn has_word(line: &str, word: &str) -> bool {
    line.match_indices(word).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + word.len()..].chars().next();
        !before.is_some_and(|c| is_word(c) || c == '-')
            && !after.is_some_and(|c| is_word(c) || c == '-')
    })
}

/// Whether `line` names the file `{stem}.md` as a filename.
fn has_filename(line: &str, stem: &str) -> bool {
    let file = format!("{stem}.md");
    line.match_indices(&file).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + file.len()..].chars().next();
        !before.is_some_and(|c| is_word(c) || c == '-') && !after.is_some_and(is_word)
    })
}

/// Every `](target)` link target on `line`.
fn link_targets(line: &str) -> Vec<&str> {
    let mut targets = Vec::new();
    let mut rest = line;
    while let Some(at) = rest.find("](") {
        let after = &rest[at + 2..];
        let Some(end) = after.find(')') else { break };
        targets.push(&after[..end]);
        rest = &after[end..];
    }
    targets
}

fn pointers_from(file: &ToolFile, tools: &[ToolFile]) -> Vec<String> {
    let allowed: HashSet<&str> = EXTERNAL_NAMES
        .iter()
        .filter(|(path, _)| *path == file.path)
        .flat_map(|(_, names)| names.iter().copied())
        .collect();
    let mut hits = Vec::new();

    for (index, line) in file.text.split('\n').enumerate() {
        let at = index + 1;
        for target in link_targets(line) {
            let external = ["http:", "https:", "mailto:", "#"]
                .iter()
                .any(|scheme| target.starts_with(scheme));
            if !external && !target.contains('{') {
                hits.push(format!("{}:{at} points at {target} (link)", file.path));
            }
        }

        for other in tools.iter().filter(|other| other.path != file.path) {
            let same_name = other.stem == file.stem;
            let pathless = other
                .path
                .contains('/')
                .then(|| other.path.trim_end_matches(".md").to_string());
            if !same_name
                && (has_filename(line, &other.stem)
                    || pathless
                        .as_ref()
                        .is_some_and(|path| line.contains(path.as_str())))
            {
                hits.push(format!(
                    "{}:{at} points at {} (path)",
                    file.path, other.path
                ));
            }

            let id = if other.overridden {
                &other.base
            } else {
                &other.stem
            };
            let mut words: BTreeSet<String> = [id.clone(), other.frontmatter_name.clone()]
                .into_iter()
                .filter(|word| word.contains(['-', '_']))
                .collect();
            for word in words.clone() {
                words.insert(word.replace('-', "_"));
                words.insert(word.replace('_', "-"));
            }
            for word in words {
                if word == file.stem
                    || word == file.frontmatter_name
                    || allowed.contains(word.as_str())
                {
                    continue;
                }
                if has_word(line, &word) {
                    hits.push(format!("{}:{at} points at {word} (name)", file.path));
                }
            }
        }
    }
    hits
}

#[test]
fn every_tool_except_automation_ends_in_itself() {
    let tools: Vec<ToolFile> = set()
        .tools()
        .iter()
        .map(|tool| {
            let frontmatter_name = tool
                .text
                .lines()
                .find_map(|line| line.strip_prefix("name:"))
                .map(|value| value.trim().to_string())
                .unwrap_or_default();
            ToolFile {
                name: tool.name.clone(),
                base: tool.name[TOOL_PREFIX.len() + 1..].to_string(),
                path: tool.path.clone(),
                text: tool.text.clone(),
                stem: tool
                    .path
                    .rsplit('/')
                    .next()
                    .unwrap()
                    .trim_end_matches(".md")
                    .to_string(),
                overridden: name_override(&tool.path).is_some(),
                frontmatter_name,
            }
        })
        .collect();

    let problems: Vec<String> = tools
        .iter()
        .filter(|tool| tool.name != hub())
        .flat_map(|tool| pointers_from(tool, &tools))
        .collect();
    assert!(
        problems.is_empty(),
        "a tool must not link to, name, or send the reader to another tool:\n{}",
        problems.join("\n")
    );
}

#[test]
fn the_pointer_audit_detects_what_it_is_for() {
    assert!(has_word("see `plan-creator` first", "plan-creator"));
    assert!(!has_word("my-plan-creator-x", "plan-creator"));
    assert!(has_filename("read versioning.md now", "versioning"));
    assert!(!has_filename("read versioning.mdx now", "versioning"));
    assert_eq!(
        link_targets("a [x](../y.md) and [z](https://e)"),
        vec!["../y.md", "https://e"]
    );
}

// The release branch form: a typo guard, not a control.

#[test]
fn every_tool_that_names_branches_states_the_release_branch_form() {
    let mut client = StdioClient::main();
    for base in ["plan_creator", "branching_strategy", "branch_and_commit"] {
        let name = tool_id(base);
        let text = client.text(&name);
        assert!(
            text.contains("release/{version}"),
            "{name} must state release/{{version}}"
        );
        let prose: Vec<&str> = text
            .split('\n')
            .filter(|line| !line.starts_with("| `release/v"))
            .collect();
        for line in prose {
            let bad = line.contains("release/v{version}")
                || line
                    .match_indices("release/v")
                    .any(|(at, _)| line[at + 9..].starts_with(|c: char| c.is_ascii_digit()));
            assert!(
                !bad,
                "{name} must not put a v in the release branch: {line}"
            );
        }
    }
}

#[test]
fn no_tool_shows_the_retired_chore_release_branch_form() {
    let mut client = StdioClient::main();
    for tool in set().tools() {
        if tool.name == tool_id("branching_strategy") {
            continue; // it lists the form once, as a bad example
        }
        assert!(
            !client.text(&tool.name).contains("chore/release"),
            "{} still shows chore/release",
            tool.name
        );
    }
}

#[test]
fn the_server_needs_no_key_to_answer() {
    let mut client = StdioClient::connect(common::MAIN, &[("API_KEY", ""), ("MCP_AUTH_TOKEN", "")]);
    assert!(
        client.text(&tool_id("plan_creator")).len() > 500,
        "the set is served without a key"
    );
}
