//! Git worktree isolation: each task can optionally run in its own worktree so
//! parallel tasks don't conflict on the same working tree.
//!
//! A worktree is created under `<project>/.warpforge/worktrees/<task_id>` on a
//! branch `warpforge/task/<task_id>` (derived from the current HEAD). When the
//! task completes the worktree can be merged back and removed, or left for
//! manual inspection. Older tasks may still have checkouts under the legacy
//! `<project>/.worktrees/<task_id>`; those paths are used exactly as recorded.
//!
//! A task can instead start from a chosen base branch, from origin, or on an
//! existing branch or pull request ([`StartPoint`]).
//!
//! Split by topic: [`manager`] holds the manager's git operations, [`detached`]
//! the manager-free versions that run off the actor, [`discover`] the boot
//! rebuild from persisted tasks, [`resolve`] and [`pull`] the base choice, and
//! [`start`] the checkouts it produces. [`setup`] applies the project's
//! `worktree:` config to a new one; [`inventory`], [`size`] and [`reclaim`]
//! serve the Worktrees panel.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

mod detached;
mod discover;
mod inventory;
mod manager;
mod merge;
mod pull;
mod reclaim;
mod resolve;
mod setup;
mod size;
mod start;

#[cfg(test)]
mod merge_tests;

#[cfg(test)]
mod setup_tests;

#[cfg(test)]
mod start_tests;

#[cfg(test)]
mod tests;

pub use detached::{create_branched_detached, default_remover, remove_detached};
#[cfg(test)]
pub use detached::{create_detached, RemoveFn};
pub use discover::parse_worktree_list;
pub use inventory::{list_managed, same_path, Listed};
pub use merge::merge_detached;
pub use reclaim::reclaim_artifacts;
pub use resolve::resolve_start;
pub use setup::{apply_config, setup_log_path};
pub use size::{cached_size, forget_size};
pub use start::{create_started, fetch_origin_default, ExistingBranch, RemoteBranch, StartPoint};

/// Prefix of the branches Warpforge creates for task worktrees.
pub(crate) const TASK_BRANCH_PREFIX: &str = "warpforge/task/";

/// Whether removing a task's worktree may delete `branch`. Only branches the
/// daemon created are; a checked-out existing branch or pull request branch is
/// the user's and outlives the task.
pub(crate) fn owns_branch(branch: &str) -> bool {
    branch.starts_with(TASK_BRANCH_PREFIX)
}

/// Project-relative directory new task worktrees live under. One constant so
/// the location is named once; `.warpforge/` is committed project config, and
/// a `.gitignore` inside `worktrees/` keeps the checkouts out of git.
pub(crate) const WORKTREES_REL: &str = ".warpforge/worktrees";

/// The directory a task's isolated checkout is created at. Legacy tasks keep
/// whatever path was recorded on them; this is only for new creations.
pub(crate) fn worktree_path(base_repo: &Path, task_id: &str) -> PathBuf {
    base_repo.join(WORKTREES_REL).join(task_id)
}

/// Metadata about one worktree.
#[derive(Debug, Clone)]
pub struct Worktree {
    pub task_id: String,
    pub path: PathBuf,
    pub branch: String,
    pub base_branch: String,
}

/// Manages git worktrees for a single project repo.
pub struct WorktreeManager {
    base_repo: PathBuf,
    worktrees: HashMap<String, Worktree>,
}

impl WorktreeManager {
    pub fn new(base_repo: PathBuf) -> Self {
        Self {
            base_repo,
            worktrees: HashMap::new(),
        }
    }

    /// The repo this manager tracks worktrees for.
    pub fn base_repo(&self) -> &Path {
        &self.base_repo
    }

    /// Drop a worktree from the map without touching git — for a removal that
    /// already ran off the actor (see [`remove_detached`]).
    pub fn forget(&mut self, task_id: &str) -> Option<Worktree> {
        self.worktrees.remove(task_id)
    }

    /// This task's worktree metadata, if the manager tracks one.
    pub fn get(&self, task_id: &str) -> Option<&Worktree> {
        self.worktrees.get(task_id)
    }

    /// Record a worktree created outside the manager (see [`create_detached`]).
    pub fn adopt(&mut self, wt: Worktree) {
        self.worktrees.insert(wt.task_id.clone(), wt);
    }

    /// The branch and path a branched worktree would inherit from, if the
    /// source task has a worktree here.
    pub fn source_state(&self, source_task_id: &str) -> Option<(String, PathBuf)> {
        self.worktrees
            .get(source_task_id)
            .map(|wt| (wt.branch.clone(), wt.path.clone()))
    }

    /// Get the working directory for a task (worktree path if it exists,
    /// otherwise the base repo).
    pub fn cwd(&self, task_id: &str) -> &Path {
        self.worktrees
            .get(task_id)
            .map(|wt| wt.path.as_path())
            .unwrap_or(&self.base_repo)
    }

    /// Check if a task has a worktree.
    pub fn has_worktree(&self, task_id: &str) -> bool {
        self.worktrees.contains_key(task_id)
    }

    /// List all active worktrees.
    pub fn list(&self) -> Vec<&Worktree> {
        self.worktrees.values().collect()
    }
}

/// What a worktree merge did, or why it did nothing. A refusal is a user
/// mistake ("commit first", "nothing to merge"); an error is a git failure.
#[derive(Debug)]
pub enum MergeResult {
    /// The base had no commits the branch lacked, so the ref moved to it.
    FastForward {
        branch: String,
    },
    /// A real merge commit was created on the base.
    Merged {
        branch: String,
        commit: String,
    },
    /// The two lines conflict. Every ref is left unchanged.
    Conflict {
        files: Vec<String>,
        message: String,
    },
    /// The merge was not attempted, with a message to show the user.
    Refused(String),
    Error(String),
}
