//! A work session's write paths (ADR 0027): where the daemon sees a write —
//! ACP `fs/write_text_file` — a path outside them is refused. And how a
//! thread's harness is kept asking before it edits or runs a command.

use std::path::{Component, Path, PathBuf};

use super::SMITH_ORIGIN;
use crate::daemon::actor::Daemon;
use crate::daemon::task::TaskWriteLimit;
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

/// opencode's permissions for a Smith's thread, merged over the user's own
/// config: every edit and command asks, and the daemon denies the ask. Its
/// `build` mode allows both silently, and its `plan` mode refuses `start_work`.
const OPENCODE_THREAD_CONFIG: &str = r#"{"permission":{"edit":"ask","bash":"ask"}}"#;

impl Daemon {
    /// Add what keeps a thread's harness asking to its process environment.
    /// @param task_id the task starting
    /// @param agent the agent it runs on
    /// @param env the agent process's environment
    pub(crate) fn smith_thread_env(
        &self,
        task_id: &str,
        agent: &str,
        env: &mut crate::daemon::accounts::AgentEnv,
    ) {
        if self.is_smith_thread(task_id) && self.agent_id_of(agent) == "opencode" {
            env.set.insert(
                "OPENCODE_CONFIG_CONTENT".into(),
                OPENCODE_THREAD_CONFIG.into(),
            );
        }
    }

    /// The write paths `task_id` is held to: its own Smith's, for a work
    /// session or a Smith-led lead, else the ones it inherited when spawned.
    /// @param task_id a task
    /// @returns the limit, `None` for a task that may write anywhere
    pub(crate) fn task_write_limit(&self, task_id: &str) -> Option<TaskWriteLimit> {
        let task = self.tasks.get(task_id)?;
        if task.origin.as_deref() == Some(SMITH_ORIGIN) {
            return None;
        }
        if let Some(record) = &task.smith {
            let smith = self.smiths.smiths.get(&record.smith_id)?;
            let paths = &smith.permissions.write_paths;
            return (!paths.is_empty()).then(|| TaskWriteLimit {
                smith_id: smith.id.clone(),
                paths: paths.clone(),
            });
        }
        task.write_limit.clone()
    }

    /// What a task created under `parent` inherits: the parent's write limit,
    /// never its Smith (ADR 0027 invariant 16).
    /// @param parent the task it is spawned under, if any
    /// @returns the limit to copy onto the new task
    pub(crate) fn inherited_write_limit(&self, parent: Option<&str>) -> Option<TaskWriteLimit> {
        self.task_write_limit(parent?)
    }

    /// Refuse a file write outside the task's write limit: a Smith work
    /// session's own, or one inherited from the Smith session it was spawned under.
    /// @param ctx the policy check
    /// @returns the denial, if the write is outside them
    pub(crate) fn smith_policy_denial(&self, ctx: &PolicyContext) -> Option<PolicyResult> {
        if ctx.tool_name.as_deref() != Some("fs/write_text_file") {
            return None;
        }
        let limit = self.task_write_limit(&ctx.task_id)?;
        let path = ctx.tool_input.as_ref()?.get("path")?.as_str()?;
        if write_allowed(&ctx.cwd, path, &limit.paths) {
            return None;
        }
        let who = self
            .smiths
            .smiths
            .get(&limit.smith_id)
            .map_or("this Smith", |smith| smith.name.as_str());
        let inherited = self
            .tasks
            .get(&ctx.task_id)
            .is_some_and(|task| task.smith.is_none());
        Some(PolicyResult::deny(format!(
            "{}{who} may write only under {}",
            if inherited {
                "spawned under a Smith: "
            } else {
                ""
            },
            limit.paths.join(", ")
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
