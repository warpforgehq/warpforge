//! Branch listing and the branch-changing ops (switch, rename, delete,
//! create). Each treats the working tree as sacred: a conflict restores the
//! exact prior state rather than leaving a half-merged tree behind.

use anyhow::{bail, Result};
use warpforge_protocol as wire;

use super::working::current_branch;
use super::{errline, git, is_dirty, op_conflict, op_error, unmerged_files};

/// `git.branches`: local branch names + the current one.
pub async fn list_branches(repo: &str) -> Result<wire::GitBranchList> {
    let out = git(repo, &["branch", "--format=%(refname:short)"]).await?;
    if !out.status.success() {
        bail!("git branch failed: {}", errline(&out));
    }
    let branches = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let remote_out = git(repo, &["branch", "-r", "--format=%(refname:short)"]).await?;
    let remotes = if remote_out.status.success() {
        String::from_utf8_lossy(&remote_out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && l.contains('/'))
            .collect()
    } else {
        Vec::new()
    };
    Ok(wire::GitBranchList {
        current: current_branch(repo).await,
        branches,
        remotes,
    })
}

/// `git.switchBranch`: smart checkout — stash uncommitted changes, switch, then
/// reapply them on the target. A conflict rolls back to the original branch
/// with the changes intact (nothing is ever discarded).
pub async fn switch_branch(repo: &str, target: &str) -> Result<wire::GitOpResult> {
    let from = match current_branch(repo).await {
        Some(b) => b,
        None => {
            return Ok(op_error(
                "not on a branch (detached HEAD or not a git repo)",
            ))
        }
    };
    if target == from {
        return Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: format!("already on '{target}'"),
            conflicts: Vec::new(),
            branch: Some(from),
        });
    }
    let verify = git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "-q",
            &format!("refs/heads/{target}"),
        ],
    )
    .await?;
    if !verify.status.success() {
        return Ok(op_error(format!("no local branch '{target}'")));
    }

    let dirty = is_dirty(repo).await?;
    if dirty {
        let st = git(repo, &["stash", "push", "-u", "-m", "warpforge-switch"]).await?;
        if !st.status.success() {
            return Ok(op_error(format!("git stash failed: {}", errline(&st))));
        }
    }

    let checkout = git(repo, &["checkout", target]).await?;
    if !checkout.status.success() {
        if dirty {
            let _ = git(repo, &["stash", "pop"]).await; // still on `from`, reapply
        }
        return Ok(op_error(format!(
            "git checkout failed: {}",
            errline(&checkout)
        )));
    }

    if dirty {
        let pop = git(repo, &["stash", "pop"]).await?;
        if !pop.status.success() {
            // Changes conflict with the target branch → go back to `from`,
            // discard the conflicted partial apply, reapply the stash cleanly.
            let conflicts = unmerged_files(repo).await;
            let _ = git(repo, &["checkout", "-f", &from]).await;
            let _ = git(repo, &["stash", "pop"]).await;
            return Ok(op_conflict(
                format!("stayed on '{from}' — your uncommitted changes conflict with '{target}'"),
                conflicts,
                Some(from),
            ));
        }
    }

    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!("switched to '{target}'"),
        conflicts: Vec::new(),
        branch: Some(target.to_string()),
    })
}

/// `git.branchRename`: rename a local branch to `new_name` (works on the branch
/// you're on or any other). Errors if `new_name` already exists.
pub async fn rename_branch(repo: &str, branch: &str, new_name: &str) -> Result<wire::GitOpResult> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Ok(op_error("new branch name is empty"));
    }
    if new_name == branch {
        return Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: "branch name already matches".to_string(),
            conflicts: Vec::new(),
            branch: Some(branch.to_string()),
        });
    }
    if new_name.contains(" ") {
        return Ok(op_error("branch name must not contain spaces"));
    }
    let exists = git(
        repo,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{new_name}"),
        ],
    )
    .await?;
    if exists.status.success() {
        return Ok(op_error(format!(
            "a branch named '{new_name}' already exists"
        )));
    }

    let out = git(repo, &["branch", "-m", branch, new_name]).await?;
    if !out.status.success() {
        return Ok(op_error(format!("git branch -m failed: {}", errline(&out))));
    }
    let is_current = current_branch(repo).await.as_deref() == Some(branch);
    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!("renamed '{branch}' to '{new_name}'"),
        conflicts: Vec::new(),
        // The active branch's name changed — reflect it so clients can update.
        branch: is_current.then(|| new_name.to_string()),
    })
}

/// `git.branchDelete`: delete a local branch. Refuses the checked-out branch;
/// without `force` also refuses unmerged branches (matches `git branch -d`).
pub async fn delete_branch(repo: &str, branch: &str, force: bool) -> Result<wire::GitOpResult> {
    if current_branch(repo).await.as_deref() == Some(branch) {
        return Ok(op_error(format!(
            "cannot delete the branch you are currently on ('{branch}'); switch first"
        )));
    }
    let flag = if force { "-D" } else { "-d" };
    let out = git(repo, &["branch", flag, branch]).await?;
    if !out.status.success() {
        return Ok(op_error(format!(
            "could not delete '{branch}': {}",
            errline(&out)
        )));
    }
    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!("deleted branch '{branch}'"),
        conflicts: Vec::new(),
        branch: None,
    })
}

/// `git.branchCreate`: create `name` from `from` (defaults to the current
/// HEAD) and check it out, carrying uncommitted changes across with the same
/// stash/rollback discipline as `switch_branch`.
pub async fn branch_create(
    repo: &str,
    name: &str,
    from: Option<&str>,
    checkout: bool,
    overwrite: bool,
) -> Result<wire::GitOpResult> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(op_error("new branch name is empty"));
    }
    if name.contains(" ") {
        return Ok(op_error("branch name must not contain spaces"));
    }
    let exists = git(
        repo,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ],
    )
    .await?;
    if exists.status.success() && !overwrite {
        return Ok(op_error(format!("a branch named '{name}' already exists")));
    }
    let original = match current_branch(repo).await {
        Some(b) => b,
        None => {
            return Ok(op_error(
                "not on a branch (detached HEAD or not a git repo)",
            ))
        }
    };
    if let Some(from) = from {
        let verify = git(repo, &["rev-parse", "--verify", "--quiet", from]).await?;
        if !verify.status.success() {
            return Ok(op_error(format!("no ref '{from}' to branch from")));
        }
    }

    let dirty = is_dirty(repo).await?;
    if dirty {
        let st = git(repo, &["stash", "push", "-u", "-m", "warpforge-branch"]).await?;
        if !st.status.success() {
            return Ok(op_error(format!("git stash failed: {}", errline(&st))));
        }
    }

    let mut args = vec!["switch"];
    if checkout {
        args.push("-C");
    } else {
        args.push("-c");
    }
    args.push(name);
    if let Some(from) = from {
        args.push(from);
    }
    let create = if checkout {
        git(repo, &args).await?
    } else {
        let mut branch_args = vec!["branch"];
        if overwrite {
            branch_args.push("-f");
        }
        branch_args.push(name);
        if let Some(from) = from {
            branch_args.push(from);
        }
        git(repo, &branch_args).await?
    };
    if !create.status.success() {
        if dirty {
            let _ = git(repo, &["stash", "pop"]).await;
        }
        return Ok(op_error(format!(
            "git switch -c failed: {}",
            errline(&create)
        )));
    }

    if dirty {
        let pop = git(repo, &["stash", "pop"]).await?;
        if !pop.status.success() {
            let conflicts = unmerged_files(repo).await;
            let _ = git(repo, &["switch", "-f", &original]).await;
            let _ = git(repo, &["stash", "pop"]).await;
            return Ok(op_conflict(
                format!("stayed on '{original}' — your uncommitted changes conflict with '{name}'"),
                conflicts,
                Some(original),
            ));
        }
    }

    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: match from {
            Some(from) => format!("created '{name}' from '{from}'"),
            None => format!("created branch '{name}'"),
        },
        conflicts: Vec::new(),
        branch: Some(name.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    #[tokio::test]
    async fn switch_branch_carries_dirty_changes() {
        let dir = std::env::temp_dir().join(format!("wf-sw-{}", uuid::Uuid::new_v4()));
        let repo = dir.to_str().unwrap();
        init_repo(&dir).await;
        std::fs::write(dir.join("a.txt"), "base\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        git(&dir, &["branch", "feature"]).await;

        // Uncommitted (non-conflicting) change, then switch.
        std::fs::write(dir.join("a.txt"), "base\ndirty\n").unwrap();
        let r = switch_branch(repo, "feature").await.unwrap();

        assert_eq!(r.status, wire::GitOpStatus::Ok, "{}", r.message);
        assert_eq!(current_branch(repo).await.as_deref(), Some("feature"));
        assert_eq!(
            std::fs::read_to_string(dir.join("a.txt")).unwrap(),
            "base\ndirty\n",
            "uncommitted change carried onto feature"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn switch_branch_conflict_rolls_back() {
        let dir = std::env::temp_dir().join(format!("wf-swc-{}", uuid::Uuid::new_v4()));
        let repo = dir.to_str().unwrap();
        init_repo(&dir).await;
        std::fs::write(dir.join("a.txt"), "line\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        let base = current_branch(repo).await.unwrap();

        // feature diverges on the same line.
        git(&dir, &["checkout", "-q", "-b", "feature"]).await;
        std::fs::write(dir.join("a.txt"), "feature-change\n").unwrap();
        git(&dir, &["commit", "-qam", "feature"]).await;
        git(&dir, &["checkout", "-q", &base]).await;

        // Uncommitted change on the same line → conflicts with feature.
        std::fs::write(dir.join("a.txt"), "local-uncommitted\n").unwrap();
        let r = switch_branch(repo, "feature").await.unwrap();

        assert_eq!(r.status, wire::GitOpStatus::Conflict, "{}", r.message);
        assert_eq!(
            current_branch(repo).await.as_deref(),
            Some(base.as_str()),
            "rolled back to the original branch"
        );
        let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
        assert_eq!(
            content, "local-uncommitted\n",
            "dirty change restored intact"
        );
        assert!(
            !content.contains("<<<<<<<"),
            "no conflict markers left behind"
        );
        assert!(
            unmerged_files(repo).await.is_empty(),
            "tree is not left in a half-merged state"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
