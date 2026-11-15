//! The server's identity and the location of the published set.

use std::path::{Path, PathBuf};

/// The name every client sees in `initialize`, and every log line starts with.
pub const SERVER_NAME: &str = "lxagents-shared-instruction";

/// The version, from `Cargo.toml`. There is no second place it is written.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The checkout this binary was built from. The fallback for [`content_dir`].
const BUILT_FROM: &str = env!("CARGO_MANIFEST_DIR");

/// The published set: the `content/` directory every served file is read from.
///
/// Found from the running executable rather than from the working directory, so a client can
/// spawn the binary from anywhere. The first ancestor of the executable that holds a `content/`
/// directory wins: that is the checkout for `target/release/…`, and `/srv` for the image's
/// `/srv/bin/…`. When none does, for a binary copied out of its checkout, the checkout it was
/// built from is used. No environment variable chooses it, so a caller cannot point the server
/// at another directory.
pub fn content_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| content_beside(&exe))
        .unwrap_or_else(|| Path::new(BUILT_FROM).join("content"))
}

/// The first `content/` directory among `exe`'s ancestors.
fn content_beside(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .skip(1)
        .map(|dir| dir.join("content"))
        .find(|candidate| candidate.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_the_crate_version() {
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
        assert!(
            VERSION.split('.').count() == 3,
            "{VERSION} is not Major.Minor.Patch"
        );
    }

    #[test]
    fn content_is_found_from_a_binary_inside_the_checkout() {
        let exe = Path::new(BUILT_FROM)
            .join("target")
            .join("release")
            .join("server");
        assert_eq!(
            content_beside(&exe),
            Some(Path::new(BUILT_FROM).join("content"))
        );
    }

    #[test]
    fn the_resolved_root_is_named_content() {
        assert!(content_dir().ends_with("content"));
        assert!(content_dir().join("automation.md").is_file());
    }
}
