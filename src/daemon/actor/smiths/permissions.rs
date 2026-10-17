//! A work session's write paths (ADR 0027): where the daemon sees a write —
//! ACP `fs/write_text_file` — a path outside them is refused.

use std::path::{Component, Path, PathBuf};

use crate::daemon::actor::Daemon;
use crate::policies::{PolicyContext, PolicyResult};

/// `path` relative to `cwd`, with `.` and `..` resolved lexically; `None`
/// when it leaves `cwd`.
fn inside(cwd: &Path, path: &str) -> Option<PathBuf> {
    let joined = cwd.join(path);
    let mut parts: Vec<Component> = Vec::new();
    for part in joined.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    let normal: PathBuf = parts.iter().collect();
    normal.strip_prefix(cwd).ok().map(Path::to_path_buf)
}

/// Whether `path` falls under one of `prefixes`, both relative to the
/// session's worktree. No prefixes means anywhere in it.
/// @param cwd the session's worktree
/// @param path the path written
/// @param prefixes the Smith's write paths
/// @returns whether the write is allowed
pub(crate) fn write_allowed(cwd: &Path, path: &str, prefixes: &[String]) -> bool {
    if prefixes.is_empty() {
        return true;
    }
    let Some(relative) = inside(cwd, path) else {
        return false;
    };
    prefixes
        .iter()
        .any(|prefix| relative.starts_with(prefix.trim_start_matches("./")))
}

impl Daemon {
    /// Refuse a Smith work session's file write outside its write paths.
    /// @param ctx the policy check
    /// @returns the denial, if the write is outside them
    pub(crate) fn smith_policy_denial(&self, ctx: &PolicyContext) -> Option<PolicyResult> {
        if ctx.tool_name.as_deref() != Some("fs/write_text_file") {
            return None;
        }
        let smith_id = self.task_smith_id(&ctx.task_id)?;
        let smith = self.smiths.smiths.get(&smith_id)?;
        let path = ctx.tool_input.as_ref()?.get("path")?.as_str()?;
        if write_allowed(&ctx.cwd, path, &smith.permissions.write_paths) {
            return None;
        }
        Some(PolicyResult::deny(format!(
            "{} may write only under {}",
            smith.name,
            smith.permissions.write_paths.join(", ")
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_stay_under_the_smiths_paths() {
        let cwd = Path::new("/work/tree");
        let paths = vec!["src/".to_string(), "docs".to_string()];
        assert!(write_allowed(cwd, "src/main.rs", &paths));
        assert!(write_allowed(cwd, "/work/tree/docs/a.md", &paths));
        assert!(write_allowed(cwd, "./src/x/../y.rs", &paths));
        assert!(!write_allowed(cwd, "Cargo.toml", &paths));
        assert!(!write_allowed(cwd, "src/../Cargo.toml", &paths));
        assert!(!write_allowed(cwd, "../other/src/a.rs", &paths));
        assert!(!write_allowed(cwd, "/etc/passwd", &paths));
        assert!(
            !write_allowed(cwd, "docsy/a.md", &paths),
            "a path prefix, not a string prefix"
        );
        assert!(
            write_allowed(cwd, "/anywhere", &[]),
            "no paths means no limit"
        );
    }
}
