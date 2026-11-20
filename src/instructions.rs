//! The tool surface: one tool per markdown file in `content/`, built once at boot.
//!
//! Everything is resolved in [`InstructionSet::load`], so a malformed set fails the process
//! rather than surfacing as a wrong answer to the first caller that needed the file. A tool call
//! is then a lookup: there is no path argument, so there is nothing for a caller to traverse
//! with, and there is no filesystem I/O on the read path.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

/// The prefix every tool id carries: `{org_name}_{repo_name}`, underscores only.
///
/// A client that connects several LXAgents servers sees all their tools in one list, so a bare
/// `api` or `plan_creator` from two servers would collide. The prefix names the server a tool
/// comes from, and is the same for every tool here.
pub const TOOL_PREFIX: &str = "lxagents_skills_shared_instruction";

/// A base name with the server prefix in front of it.
pub fn tool_id(base: &str) -> String {
    format!("{TOOL_PREFIX}_{base}")
}

/// Names that do not survive mechanical derivation, as `(set-relative path, base name)`.
///
/// Everything else is named after its own filename, so adding a file to `content/` adds the
/// tool that serves it without anyone deciding what to call it. The exceptions are the
/// per-forge pages: the folder is dropped from the derived name, so `api`, `authentication`,
/// `issues` and `repositories` exist on both forges and would collide, and the rest say nothing
/// about which forge they belong to. Each is named for its forge instead.
///
/// A path that matches no file is a startup error, so a rename cannot leave an override quietly
/// matching nothing.
pub const OVERRIDE_BASES: &[(&str, &str)] = &[
    ("skills/github/actions.md", "github_actions"),
    ("skills/github/api.md", "github_api"),
    ("skills/github/authentication.md", "github_authentication"),
    ("skills/github/issues.md", "github_issues"),
    ("skills/github/pull-requests.md", "github_pull_requests"),
    ("skills/github/releases.md", "github_releases"),
    ("skills/github/repositories.md", "github_repositories"),
    ("skills/gitlab/api.md", "gitlab_api"),
    ("skills/gitlab/authentication.md", "gitlab_authentication"),
    ("skills/gitlab/ci.md", "gitlab_ci"),
    ("skills/gitlab/issues.md", "gitlab_issues"),
    ("skills/gitlab/merge-requests.md", "gitlab_merge_requests"),
    ("skills/gitlab/repositories.md", "gitlab_repositories"),
];

/// The full tool id an override gives `path`, if it has one.
pub fn name_override(path: &str) -> Option<String> {
    OVERRIDE_BASES
        .iter()
        .find(|(overridden, _)| *overridden == path)
        .map(|(_, base)| tool_id(base))
}

/// The tool name a set-relative path is published under.
///
/// The folder is dropped, `.md` removed, kebab case turned to snake case, and the prefix added,
/// so `git/branching-strategy.md` is `lxagents_skills_shared_instruction_branching_strategy`.
/// Two folders holding the same filename would collide, which [`InstructionSet::load`] treats
/// as a startup error rather than letting the second file shadow the first.
pub fn tool_name_for(path: &str) -> String {
    if let Some(name) = name_override(path) {
        return name;
    }
    let file = path.rsplit('/').next().unwrap_or(path);
    let base = file
        .strip_suffix(".md")
        .unwrap_or(file)
        .to_lowercase()
        .replace('-', "_");
    tool_id(&base)
}

/// Whether `name` has the shape an MCP client accepts: `^[a-z][a-z0-9_]{0,127}$`.
pub fn is_valid_tool_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 128
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// The single-line scalar fields of a file's frontmatter, or `None` when it has none.
///
/// The block is the text between a first line of `---` and the next line that starts with
/// `---`. Only `key: value` lines are read; a folded YAML value would need a real parser, and a
/// field this misses is caught as a missing description rather than served empty.
pub fn parse_frontmatter(text: &str) -> Option<HashMap<String, String>> {
    let body = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))?;
    let end = body.find("\n---")?;
    let block = body[..end].strip_suffix('\r').unwrap_or(&body[..end]);

    let fields = block
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .filter_map(frontmatter_field)
        .collect();
    Some(fields)
}

/// One `key: value` line, or `None` when the line is not one.
fn frontmatter_field(line: &str) -> Option<(String, String)> {
    let (key, value) = line.split_once(':')?;
    let mut key_chars = key.chars();
    let key_ok = key_chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && key_chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    key_ok.then(|| (key.to_string(), value.trim().to_string()))
}

/// One served file: the tool it is published as, and the text it returns whole.
#[derive(Debug, Clone)]
pub struct Instruction {
    /// The tool id.
    pub name: String,
    /// The tool description: the `description` in the file's own frontmatter.
    pub description: String,
    /// The set-relative, forward-slash path of the file.
    pub path: String,
    /// The whole file, frontmatter included, byte-identical to what is on disk.
    pub text: String,
}

/// The whole tool surface, read once and never changed.
#[derive(Debug)]
pub struct InstructionSet {
    tools: Vec<Instruction>,
    by_name: HashMap<String, usize>,
}

impl InstructionSet {
    /// Read every markdown file under `content_dir` and build the surface, or say why not.
    pub fn load(content_dir: &Path) -> Result<Self, String> {
        let paths = markdown_files(content_dir)?;
        check_overrides(&paths)?;

        let mut tools = Vec::with_capacity(paths.len());
        let mut by_name = HashMap::with_capacity(paths.len());
        for path in paths {
            let tool = read_instruction(content_dir, &path)?;
            if let Some(&earlier) = by_name.get(&tool.name) {
                let earlier: &Instruction = &tools[earlier];
                return Err(format!(
                    "{path} and {} both derive the tool name \"{}\". One would silently shadow the other; add one to OVERRIDE_BASES.",
                    earlier.path, tool.name
                ));
            }
            by_name.insert(tool.name.clone(), tools.len());
            tools.push(tool);
        }

        if tools.is_empty() {
            return Err(format!(
                "No markdown files under {}. This server would expose nothing.",
                content_dir.display()
            ));
        }
        Ok(Self { tools, by_name })
    }

    /// Every tool, in the order a client lists them: sorted by path.
    pub fn tools(&self) -> &[Instruction] {
        &self.tools
    }

    /// The tool published as `name`.
    pub fn get(&self, name: &str) -> Option<&Instruction> {
        self.by_name.get(name).map(|&index| &self.tools[index])
    }

    /// How many tools there are.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Whether there are none. [`InstructionSet::load`] never builds an empty set.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }
}

/// A key in [`OVERRIDE_BASES`] that matches no file is an error.
fn check_overrides(paths: &[String]) -> Result<(), String> {
    let present: HashSet<&str> = paths.iter().map(String::as_str).collect();
    match OVERRIDE_BASES
        .iter()
        .find(|(path, _)| !present.contains(path))
    {
        Some((path, _)) => Err(format!(
            "OVERRIDE_BASES names {path}, which is not in the set. Remove the override or restore the file."
        )),
        None => Ok(()),
    }
}

/// Read one file and check it can be published.
fn read_instruction(content_dir: &Path, path: &str) -> Result<Instruction, String> {
    let name = tool_name_for(path);
    if !is_valid_tool_name(&name) {
        return Err(format!(
            "{path} derives the tool name \"{name}\", which is not a valid MCP tool name. Add it to OVERRIDE_BASES."
        ));
    }

    let text = fs::read_to_string(content_dir.join(path))
        .map_err(|error| format!("{path} cannot be read: {error}"))?;
    let description = parse_frontmatter(&text)
        .and_then(|fields| fields.get("description").cloned())
        .filter(|description| !description.is_empty())
        .ok_or_else(|| {
            format!("{path} has no frontmatter `description:`. It would publish as a tool a client cannot route on.")
        })?;

    Ok(Instruction {
        name,
        description,
        path: path.to_string(),
        text,
    })
}

/// Every `.md` under `root`, as set-relative forward-slash paths, sorted.
pub fn markdown_files(root: &Path) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    collect_markdown(root, root, &mut found)?;
    found.sort();
    Ok(found)
}

fn collect_markdown(root: &Path, dir: &Path, found: &mut Vec<String>) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|error| format!("{} cannot be read: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("{} cannot be read: {error}", dir.display()))?;
        let full = entry.path();
        if full.is_dir() {
            collect_markdown(root, &full, found)?;
        } else if full.extension().is_some_and(|ext| ext == "md") {
            let relative = full.strip_prefix(root).map_err(|error| error.to_string())?;
            let parts: Vec<String> = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect();
            found.push(parts.join("/"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_derived_from_the_filename() {
        assert_eq!(
            tool_name_for("git/branching-strategy.md"),
            tool_id("branching_strategy")
        );
        assert_eq!(tool_name_for("automation.md"), tool_id("automation"));
        assert_eq!(tool_name_for("skills/github/api.md"), tool_id("github_api"));
    }

    #[test]
    fn tool_names_are_checked_for_shape() {
        assert!(is_valid_tool_name("a_b1"));
        assert!(!is_valid_tool_name(""));
        assert!(!is_valid_tool_name("1a"));
        assert!(!is_valid_tool_name("a-b"));
        assert!(!is_valid_tool_name(&"a".repeat(129)));
        assert!(is_valid_tool_name(&"a".repeat(128)));
    }

    #[test]
    fn frontmatter_reads_single_line_fields() {
        let fields =
            parse_frontmatter("---\nname: x\ndescription:   y z  \nfolded: >\n---\nbody").unwrap();
        assert_eq!(fields["name"], "x");
        assert_eq!(fields["description"], "y z");
        assert_eq!(fields["folded"], ">");
        let crlf = parse_frontmatter("---\r\nname: x\r\ndescription: d\r\n---\r\n").unwrap();
        assert_eq!(crlf["description"], "d");
        assert!(parse_frontmatter("no frontmatter").is_none());
        assert!(parse_frontmatter("---\nname: x\n").is_none());
    }

    #[test]
    fn a_line_with_a_bad_key_is_not_a_field() {
        let fields = parse_frontmatter("---\n- item: no\n9x: no\nok_1: yes\n---\n").unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields["ok_1"], "yes");
    }

    #[test]
    fn a_set_with_a_stale_override_a_shadowed_name_or_no_description_fails_to_load() {
        let dir = std::env::temp_dir().join(format!("lxagents-si-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let write = |path: &str, text: &str| {
            let full = dir.join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, text).unwrap();
        };
        let page = "---\nname: s\ndescription: d\n---\n";

        write("a/same.md", page);
        assert!(
            InstructionSet::load(&dir)
                .unwrap_err()
                .contains("OVERRIDE_BASES names")
        );

        for (path, _) in OVERRIDE_BASES {
            write(path, page);
        }
        assert_eq!(
            InstructionSet::load(&dir).unwrap().len(),
            OVERRIDE_BASES.len() + 1
        );

        write("b/same.md", page);
        assert!(
            InstructionSet::load(&dir)
                .unwrap_err()
                .contains("both derive the tool name")
        );

        fs::remove_file(dir.join("b/same.md")).unwrap();
        write("b/bare.md", "no frontmatter");
        assert!(
            InstructionSet::load(&dir)
                .unwrap_err()
                .contains("has no frontmatter `description:`")
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
