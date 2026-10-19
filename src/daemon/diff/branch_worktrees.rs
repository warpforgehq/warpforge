//! Which local branches another worktree of the repository has checked out.
//! git refuses to check such a branch out a second time, so the picker routes
//! it to the owning task or names the path instead (ADR 0015).

use std::path::Path;

use warpforge_protocol as wire;

use super::git;
use super::working::current_branch;
use crate::daemon::worktree::{parse_worktree_list, WORKTREES_REL};

/// Branches held by worktrees other than the one on `current`.
///
/// @param porcelain Output of `git worktree list --porcelain`.
/// @param current Branch of the checkout asking; excluded from the result.
/// @returns One entry per held branch, `task_id` left unset.
pub(super) fn held_branches(porcelain: &str, current: Option<&str>) -> Vec<wire::BranchWorktree> {
    let listed = parse_worktree_list(porcelain);
    let Some(root) = listed.first().map(|w| w.path.clone()) else {
        return Vec::new();
    };
    let dirs = [root.join(WORKTREES_REL), root.join(".worktrees")];
    listed
        .into_iter()
        .enumerate()
        .filter_map(|(i, w)| {
            let branch = w.branch?;
            if Some(branch.as_str()) == current {
                return None;
            }
            Some(wire::BranchWorktree {
                branch,
                primary: i == 0,
                managed: dirs.iter().any(|d| w.path.starts_with(d)),
                path: w.path.to_string_lossy().into_owned(),
                task_id: None,
            })
        })
        .collect()
}

/// The other worktree holding `branch`, if any.
///
/// @param repo Checkout the branch would be switched in.
/// @param branch Local branch name.
/// @returns The holder, or `None` when free or when git cannot list worktrees.
pub(super) async fn held_elsewhere(repo: &str, branch: &str) -> Option<wire::BranchWorktree> {
    let out = git(repo, &["worktree", "list", "--porcelain"]).await.ok()?;
    if !out.status.success() {
        return None;
    }
    let current = current_branch(repo).await;
    held_branches(&String::from_utf8_lossy(&out.stdout), current.as_deref())
        .into_iter()
        .find(|h| h.branch == branch)
}

/// Human explanation of why `branch` cannot be checked out here.
///
/// @param branch Local branch name.
/// @param holder The worktree holding it.
/// @returns One sentence naming the path.
pub(super) fn held_message(branch: &str, holder: &wire::BranchWorktree) -> String {
    let path = Path::new(&holder.path).display();
    if holder.managed {
        format!("'{branch}' is open in a Warpforge task's worktree at {path}. Open that task to work on it.")
    } else if holder.primary {
        format!("'{branch}' is checked out in the project folder at {path}. Switch that checkout to another branch first.")
    } else {
        format!("'{branch}' is checked out in another worktree at {path}. Switch that worktree to another branch first.")
    }
}

#[cfg(test)]
mod tests {
    use super::super::branch::{list_branches, switch_branch};
    use super::super::testsupport::{git, init_repo};
    use super::*;

    const PORCELAIN: &str = "worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.warpforge/worktrees/t_1
HEAD bbb
branch refs/heads/warpforge/task/t_1

worktree /repo/.worktrees/t_0
HEAD ccc
branch refs/heads/legacy

worktree /elsewhere/wt
HEAD ddd
branch refs/heads/feature

worktree /elsewhere/detached
HEAD eee
detached
";

    #[test]
    fn held_branches_classifies_each_worktree() {
        let held = held_branches(PORCELAIN, Some("feature"));
        let summary: Vec<_> = held
            .iter()
            .map(|h| (h.branch.as_str(), h.path.as_str(), h.primary, h.managed))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("main", "/repo", true, false),
                (
                    "warpforge/task/t_1",
                    "/repo/.warpforge/worktrees/t_1",
                    false,
                    true
                ),
                ("legacy", "/repo/.worktrees/t_0", false, true),
            ]
        );
        assert!(held.iter().all(|h| h.task_id.is_none()));
    }

    #[test]
    fn held_branches_excludes_current_from_the_main_worktree() {
        let held = held_branches(PORCELAIN, Some("main"));
        assert!(held.iter().all(|h| h.branch != "main"));
        assert_eq!(held.len(), 3);
    }

    #[tokio::test]
    async fn task_worktree_branch_is_listed_and_refused() {
        let dir = std::env::temp_dir().join(format!("wf-bwt-{}", uuid::Uuid::new_v4()));
        let repo = dir.to_str().unwrap();
        init_repo(&dir).await;
        std::fs::write(dir.join("a.txt"), "base\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        let base = current_branch(repo).await.unwrap();
        let wt = dir.join(".warpforge/worktrees/t_x");
        let wt_str = wt.to_str().unwrap();
        git(
            &dir,
            &["worktree", "add", "-q", wt_str, "-b", "warpforge/task/t_x"],
        )
        .await;

        let list = list_branches(repo).await.unwrap();
        let held = list
            .worktrees
            .iter()
            .find(|h| h.branch == "warpforge/task/t_x")
            .expect("task branch reported as held");
        assert!(held.managed && !held.primary);
        assert!(
            held.path.ends_with(".warpforge/worktrees/t_x"),
            "{}",
            held.path
        );
        assert!(list.worktrees.iter().all(|h| h.branch != base));

        let r = switch_branch(repo, "warpforge/task/t_x").await.unwrap();
        assert_eq!(r.status, wire::GitOpStatus::Error);
        assert!(!r.message.contains("fatal"), "{}", r.message);
        assert!(
            r.message.contains(".warpforge/worktrees/t_x"),
            "{}",
            r.message
        );
        assert_eq!(current_branch(repo).await.as_deref(), Some(base.as_str()));
        std::fs::remove_dir_all(&dir).ok();
    }
}
