//! Manager-owned git operations: create, branch, remove, merge. The
//! manager-free versions the daemon actually uses run off the actor
//! ([`super::detached`]); these are used by tests and by any caller that
//! already owns the actor loop.

use anyhow::{Context, Result};

use super::detached::{copy_working_state, create_detached};
use super::{MergeResult, Worktree, WorktreeManager};

impl WorktreeManager {
    /// Create a worktree for `task_id`. If `base_branch` is provided, branch
    /// from that; otherwise branch from the current HEAD.
    pub async fn create(&mut self, task_id: &str, base_branch: Option<&str>) -> Result<Worktree> {
        let wt = create_detached(&self.base_repo, task_id, base_branch).await?;
        self.adopt(wt.clone());
        Ok(wt)
    }

    /// Create a worktree for `task_id` that inherits the state of a source
    /// worktree (used for conversation branches). Branches from the source
    /// worktree's branch and copies its uncommitted changes so the new task
    /// starts exactly where the source left off, rather than from a clean HEAD.
    pub async fn create_branched(
        &mut self,
        task_id: &str,
        source_task_id: &str,
    ) -> Result<Worktree> {
        let source = self
            .worktrees
            .get(source_task_id)
            .with_context(|| format!("no worktree for source task {source_task_id}"))?;
        let base_branch = source.branch.clone();
        let source_path = source.path.clone();
        let wt = self.create(task_id, Some(&base_branch)).await?;
        copy_working_state(&source_path, &wt.path)
            .await
            .with_context(|| {
                format!("failed to copy working state into branched worktree {task_id}")
            })?;
        Ok(wt)
    }

    /// Remove a worktree and its branch.
    pub async fn remove(&mut self, task_id: &str) -> Result<()> {
        let wt = self
            .worktrees
            .remove(task_id)
            .with_context(|| format!("no worktree for task {task_id}"))?;
        crate::daemon::explorer::registry().forget(&wt.path);

        // Remove the worktree (git cleans up the dir).
        let status = tokio::process::Command::new("git")
            .args([
                "worktree",
                "remove",
                "--force",
                wt.path.to_str().unwrap_or(""),
            ])
            .current_dir(&self.base_repo)
            .status()
            .await
            .context("failed to run git worktree remove")?;

        if !status.success() {
            anyhow::bail!("git worktree remove failed (exit {status})");
        }

        if !super::owns_branch(&wt.branch) {
            return Ok(());
        }
        let _ = tokio::process::Command::new("git")
            .args(["branch", "-D", &wt.branch])
            .current_dir(&self.base_repo)
            .status()
            .await;

        Ok(())
    }

    /// Merge the worktree's branch back into its base branch. Delegates to the
    /// safe, manager-free path so there is one merge implementation.
    pub async fn merge(&self, task_id: &str) -> Result<MergeResult> {
        let wt = self
            .worktrees
            .get(task_id)
            .with_context(|| format!("no worktree for task {task_id}"))?;
        super::merge::merge_detached(&self.base_repo, &wt.path, &wt.branch, &wt.base_branch).await
    }
}
