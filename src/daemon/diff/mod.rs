//! Git-backed diff/review for a task, split by topic:
//!
//! - [`working`] — the working tree read the Changes rail is built on
//!   (tracked, untracked and ignored answered separately);
//! - [`roots`] — the project's checkout plus any nested ones (`git.roots`);
//! - [`listing`], [`files`] — the editor's file tree and single-file reads;
//! - [`branch`], [`sync`], [`remote`] — branch ops, pull/rebase/merge, push/PR;
//! - [`commit`], [`parse`] — committing and rejecting hunks, diff parsing.
//!
//! "Accept" is a no-op on the tree (the change stays); only "reject" touches
//! files, so review is non-destructive until you deliberately reject.

use anyhow::Result;
use tokio::process::Command;
use warpforge_protocol as wire;

mod branch;
mod commit;
mod files;
mod listing;
mod parse;
mod remote;
mod roots;
mod sync;
mod working;

pub use branch::{branch_create, delete_branch, list_branches, rename_branch, switch_branch};
pub use commit::{commit, last_commit_message, reject_hunk, stage_paths};
pub use files::{create_file, delete_file, file_doc, rename_file, save_file};
pub use listing::{is_ignored_path, list_files};
pub use remote::{create_pr, push, push_info};
pub use roots::git_roots;
pub use sync::{merge, rebase, update_project};
pub use working::{
    current_branch, ignore_paths, ignored_files, tracked_diff, untracked_diff, working_diff,
};

/// Build/dependency directories, skipped at any depth. Keeping them costs
/// ~162k entries on this repo alone, and the editor tree never wants them —
/// but other .gitignore'd files (`.env` and friends) stay listed.
pub(super) const HEAVY_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", ".next"];

/// OS / editor junk never shown in the file tree.
const IGNORED_NAMES: &[&str] = &[
    ".DS_Store",
    "Thumbs.db",
    "Desktop.ini",
    ".AppleDouble",
    ".LSOverride",
    "._*",
    "*.swp",
    "*.swo",
    "*~",
];

// Shared helpers for the git-shelling topic modules below.
//
// The ops that change a checkout treat the working tree as sacred: if anything conflicts, we restore
// the exact prior state (branch, HEAD, and uncommitted changes) and report the
// blocking files, rather than leaving a half-merged tree an agent might commit.

async fn git(repo: &str, args: &[&str]) -> Result<std::process::Output> {
    Ok(Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .await?)
}

fn errline(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).trim().to_string()
}

async fn rev_parse_head(repo: &str) -> Result<String> {
    let out = git(repo, &["rev-parse", "HEAD"]).await?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// True if the working tree has any tracked or untracked changes.
async fn is_dirty(repo: &str) -> Result<bool> {
    let out = git(repo, &["status", "--porcelain"]).await?;
    Ok(!String::from_utf8_lossy(&out.stdout).trim().is_empty())
}

/// Files left unmerged (conflict markers) after a failed rebase/stash-pop.
async fn unmerged_files(repo: &str) -> Vec<String> {
    match git(repo, &["diff", "--name-only", "--diff-filter=U"]).await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn op_error(msg: impl Into<String>) -> wire::GitOpResult {
    wire::GitOpResult {
        status: wire::GitOpStatus::Error,
        message: msg.into(),
        conflicts: Vec::new(),
        branch: None,
    }
}

fn op_conflict(
    msg: impl Into<String>,
    conflicts: Vec<String>,
    branch: Option<String>,
) -> wire::GitOpResult {
    wire::GitOpResult {
        status: wire::GitOpStatus::Conflict,
        message: msg.into(),
        conflicts,
        branch,
    }
}

#[cfg(test)]
pub(super) mod testsupport {
    use tokio::process::Command;

    pub(super) async fn git(repo: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .await
            .unwrap();
        assert!(
            status.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// A repo with an identity configured, and no commits yet.
    pub(super) async fn init_repo(dir: &std::path::Path) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q"]).await;
        git(dir, &["config", "user.email", "t@t"]).await;
        git(dir, &["config", "user.name", "t"]).await;
    }
}
