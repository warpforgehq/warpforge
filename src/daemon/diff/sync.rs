//! Bringing a checkout up to date: pull (`update_project`), rebase and merge.
//! All three autostash and roll back atomically on conflict.

use anyhow::Result;
use warpforge_protocol as wire;

use super::working::current_branch;
use super::{errline, git, is_dirty, op_conflict, op_error, rev_parse_head, unmerged_files};

/// `git.update`: fetch + rebase the current branch onto its upstream, stashing
/// and restoring uncommitted changes around it. Any conflict rolls back.
pub async fn update_project(repo: &str) -> Result<wire::GitOpResult> {
    let branch = match current_branch(repo).await {
        Some(b) => b,
        None => {
            return Ok(op_error(
                "not on a branch (detached HEAD or not a git repo)",
            ))
        }
    };

    // Need an upstream to update from.
    let upstream = git(
        repo,
        &["rev-parse", "--abbrev-ref", "--verify", "-q", "@{u}"],
    )
    .await?;
    if !upstream.status.success() {
        return Ok(op_error(format!("no upstream configured for '{branch}'")));
    }

    let fetch = git(repo, &["fetch"]).await?;
    if !fetch.status.success() {
        return Ok(op_error(format!("git fetch failed: {}", errline(&fetch))));
    }

    let start = rev_parse_head(repo).await?;
    let dirty = is_dirty(repo).await?;
    if dirty {
        let st = git(repo, &["stash", "push", "-u", "-m", "warpforge-update"]).await?;
        if !st.status.success() {
            return Ok(op_error(format!("git stash failed: {}", errline(&st))));
        }
    }

    // Rebase onto the freshly-fetched upstream.
    let rebase = git(repo, &["rebase", "@{u}"]).await?;
    if !rebase.status.success() {
        // Local commits conflict with the incoming ones. Capture before abort
        // (abort clears the unmerged state), then restore the prior tree.
        let conflicts = unmerged_files(repo).await;
        let _ = git(repo, &["rebase", "--abort"]).await; // HEAD + tree back to `start`
        if dirty {
            let _ = git(repo, &["stash", "pop"]).await; // clean reapply onto `start`
        }
        return Ok(op_conflict(
            format!("update rolled back — '{branch}' and its upstream have conflicting commits"),
            conflicts,
            Some(branch.to_string()),
        ));
    }

    // Rebase clean; put uncommitted changes back on top.
    if dirty {
        let pop = git(repo, &["stash", "pop"]).await?;
        if !pop.status.success() {
            // Uncommitted changes clash with the pulled update → full rollback:
            // discard the pulled commits + conflict markers, reapply the stash
            // onto the original HEAD (where it was taken, so it's always clean).
            let conflicts = unmerged_files(repo).await;
            let _ = git(repo, &["reset", "--hard", &start]).await;
            let _ = git(repo, &["stash", "pop"]).await;
            return Ok(op_conflict(
                format!("update rolled back — your uncommitted changes conflict with the incoming update on '{branch}'"),
                conflicts,
                Some(branch.to_string()),
            ));
        }
    }

    let head = rev_parse_head(repo).await?;
    if head == start {
        Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: format!("already up to date on '{branch}'"),
            conflicts: Vec::new(),
            branch: Some(branch),
        })
    } else {
        Ok(wire::GitOpResult {
            status: wire::GitOpStatus::Ok,
            message: format!("updated '{branch}' from upstream"),
            conflicts: Vec::new(),
            branch: Some(branch),
        })
    }
}

/// `git.rebase`: rebase `branch` onto `onto` without checking it out. The
/// current working tree is stashed and restored, so selecting another branch
/// never changes the user's checkout.
pub async fn rebase(repo: &str, branch: &str, onto: &str) -> Result<wire::GitOpResult> {
    let _current = match current_branch(repo).await {
        Some(b) => b,
        None => {
            return Ok(op_error(
                "not on a branch (detached HEAD or not a git repo)",
            ))
        }
    };
    if onto == branch {
        return Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: format!("'{branch}' is already on '{onto}'"),
            conflicts: Vec::new(),
            branch: Some(branch.to_string()),
        });
    }

    let verify = git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .await?;
    if !verify.status.success() {
        return Ok(op_error(format!("no local branch '{branch}'")));
    }
    let base = git(repo, &["merge-base", branch, onto]).await?;
    if !base.status.success() {
        return Ok(op_error(format!(
            "could not find common base for '{branch}' and '{onto}'"
        )));
    }
    let base = String::from_utf8_lossy(&base.stdout).trim().to_string();
    let start = rev_parse_head(repo).await?;
    let dirty = is_dirty(repo).await?;
    if dirty {
        let st = git(repo, &["stash", "push", "-u", "-m", "warpforge-rebase"]).await?;
        if !st.status.success() {
            return Ok(op_error(format!("git stash failed: {}", errline(&st))));
        }
    }

    let out = git(repo, &["rebase", "--onto", onto, &base, branch]).await?;
    if !out.status.success() {
        let conflicts = unmerged_files(repo).await;
        let _ = git(repo, &["rebase", "--abort"]).await;
        if dirty {
            let _ = git(repo, &["stash", "pop"]).await;
        }
        return Ok(op_conflict(
            format!("rebase rolled back — '{branch}' conflicts with '{onto}'"),
            conflicts,
            Some(branch.to_string()),
        ));
    }

    if dirty {
        let pop = git(repo, &["stash", "pop"]).await?;
        if !pop.status.success() {
            let conflicts = unmerged_files(repo).await;
            let _ = git(repo, &["reset", "--hard", &start]).await;
            let _ = git(repo, &["stash", "pop"]).await;
            return Ok(op_conflict(
                format!("rebase rolled back — your uncommitted changes conflict with '{onto}'"),
                conflicts,
                Some(branch.to_string()),
            ));
        }
    }

    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!("rebased '{branch}' onto '{onto}'"),
        conflicts: Vec::new(),
        branch: Some(branch.to_string()),
    })
}

/// `git.merge`: merge `target` into the current branch, stashing and restoring
/// uncommitted changes. Any conflict rolls back to the prior tree.
pub async fn merge(repo: &str, target: &str) -> Result<wire::GitOpResult> {
    let branch = match current_branch(repo).await {
        Some(b) => b,
        None => {
            return Ok(op_error(
                "not on a branch (detached HEAD or not a git repo)",
            ))
        }
    };
    if target == branch {
        return Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: format!("'{branch}' is already up to date with itself"),
            conflicts: Vec::new(),
            branch: Some(branch),
        });
    }
    let (start, dirty) = (rev_parse_head(repo).await?, is_dirty(repo).await?);
    if dirty {
        let st = git(repo, &["stash", "push", "-u", "-m", "warpforge-merge"]).await?;
        if !st.status.success() {
            return Ok(op_error(format!("git stash failed: {}", errline(&st))));
        }
    }

    let out = git(repo, &["merge", "--no-edit", target]).await?;
    if !out.status.success() {
        let conflicts = unmerged_files(repo).await;
        let _ = git(repo, &["merge", "--abort"]).await;
        if dirty {
            let _ = git(repo, &["stash", "pop"]).await;
        }
        return Ok(op_conflict(
            format!("merge rolled back — '{target}' conflicts with '{branch}'"),
            conflicts,
            Some(branch),
        ));
    }

    if dirty {
        let pop = git(repo, &["stash", "pop"]).await?;
        if !pop.status.success() {
            let conflicts = unmerged_files(repo).await;
            let _ = git(repo, &["reset", "--hard", &start]).await;
            let _ = git(repo, &["stash", "pop"]).await;
            return Ok(op_conflict(
                format!("merge rolled back — your uncommitted changes conflict with '{target}'"),
                conflicts,
                Some(branch),
            ));
        }
    }

    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!("merged '{target}' into '{branch}'"),
        conflicts: Vec::new(),
        branch: Some(branch),
    })
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::git;
    use super::*;

    #[tokio::test]
    async fn update_project_rebases_and_keeps_dirty() {
        let root = std::env::temp_dir().join(format!("wf-upd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin.git");
        let origin_url = origin.to_str().unwrap();

        // Bare origin + two clones (one advances upstream).
        git(&root, &["init", "--bare", "-q", origin_url]).await;
        git(&root, &["clone", "-q", origin_url, "work"]).await;
        let work = root.join("work");
        let workp = work.to_str().unwrap();
        git(&work, &["config", "user.email", "t@t"]).await;
        git(&work, &["config", "user.name", "t"]).await;
        std::fs::write(work.join("a.txt"), "base\n").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-q", "-m", "init"]).await;
        git(&work, &["push", "-q", "-u", "origin", "HEAD"]).await;

        git(&root, &["clone", "-q", origin_url, "other"]).await;
        let other = root.join("other");
        git(&other, &["config", "user.email", "t@t"]).await;
        git(&other, &["config", "user.name", "t"]).await;
        std::fs::write(other.join("b.txt"), "upstream\n").unwrap();
        git(&other, &["add", "."]).await;
        git(&other, &["commit", "-q", "-m", "upstream"]).await;
        git(&other, &["push", "-q", "origin", "HEAD"]).await;

        // work has a dirty (untracked) file; update should pull + preserve it.
        std::fs::write(work.join("dirty.txt"), "wip\n").unwrap();
        let r = update_project(workp).await.unwrap();

        assert_eq!(r.status, wire::GitOpStatus::Ok, "{}", r.message);
        assert!(work.join("b.txt").is_file(), "upstream commit pulled in");
        assert_eq!(
            std::fs::read_to_string(work.join("dirty.txt")).unwrap(),
            "wip\n",
            "uncommitted change preserved across update"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
