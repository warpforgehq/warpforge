//! Where a branch's pull request starts: the merge-base with the PR base.

use super::git;

/// The commit the branch forked from its PR base at.
///
/// Tries the task's base branch (its remote-tracking ref first, since that is
/// what the PR targets), then the remote default branch from `origin/HEAD`.
/// Reads only local refs.
///
/// @param repo Path of the checkout.
/// @param base The task's base branch, when known.
/// @returns The merge-base sha, or `None` when no base ref resolves.
pub(crate) async fn pr_merge_base(repo: &str, base: Option<&str>) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(base) = base.map(str::trim).filter(|b| !b.is_empty()) {
        candidates.push(format!("origin/{base}"));
        candidates.push(base.to_string());
    }
    candidates.push("origin/HEAD".to_string());
    for candidate in candidates {
        let Ok(out) = git(repo, &["merge-base", "HEAD", &candidate]).await else {
            continue;
        };
        if out.status.success() {
            let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !sha.is_empty() {
                return Some(sha);
            }
        }
    }
    None
}

/// Commit subjects (oldest first, one `- ` line each) and the combined diff of
/// what a pull request for the branch would contain.
///
/// Falls back to History’s local-only commit selection when no PR base resolves.
///
/// @param repo Path of the checkout.
/// @param base The task's base branch, when known.
/// @returns `(subjects, diff)`, or an error when the branch has nothing to describe.
pub(crate) async fn pr_material(
    repo: &str,
    base: Option<&str>,
) -> Result<(String, String), String> {
    let (commits, merge_base) = super::history::branch_commits_with_base(repo, base)
        .await
        .map_err(|e| e.to_string())?;
    let oldest = commits
        .last()
        .ok_or_else(|| "no commits on this branch to describe".to_string())?;
    let subjects = commits
        .iter()
        .rev()
        .map(|c| format!("- {}", c.subject))
        .collect::<Vec<_>>()
        .join("\n");
    let start = match merge_base {
        Some(base) => base,
        None => {
            let parent = format!("{}^", oldest.hash);
            let out = git(repo, &["rev-parse", "--verify", &parent])
                .await
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                parent
            } else {
                // Hash the empty tree so root commits work with either Git object format.
                let empty = git(repo, &["hash-object", "-t", "tree", "--stdin"])
                    .await
                    .map_err(|e| e.to_string())?;
                String::from_utf8_lossy(&empty.stdout).trim().to_string()
            }
        }
    };
    let range = format!("{start}..HEAD");
    let diff = git(repo, &["diff", &range])
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    Ok((subjects, diff))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::diff::{
        branch_commits,
        testsupport::{git, init_repo},
    };

    #[tokio::test]
    async fn no_base_material_matches_history_including_root() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        init_repo(d).await;
        std::fs::write(d.join("a"), "root\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-qm", "root"]).await;
        std::fs::write(d.join("b"), "second\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-qm", "second"]).await;
        let repo = d.to_str().unwrap();
        let commits = branch_commits(repo, None).await.unwrap();
        let (subjects, diff) = pr_material(repo, None).await.unwrap();
        assert_eq!(
            subjects,
            commits
                .iter()
                .rev()
                .map(|c| format!("- {}", c.subject))
                .collect::<Vec<_>>()
                .join("\n")
        );
        assert_eq!(subjects, "- root\n- second");
        assert!(diff.contains("+root"));
        assert!(diff.contains("+second"));

        git(d, &["update-ref", "refs/remotes/origin/feature", "HEAD^"]).await;
        let commits = branch_commits(repo, None).await.unwrap();
        let (subjects, diff) = pr_material(repo, None).await.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(subjects, format!("- {}", commits[0].subject));
        assert!(!diff.contains("+root"));
        assert!(diff.contains("+second"));

        git(d, &["update-ref", "refs/remotes/origin/feature", "HEAD"]).await;
        assert_eq!(
            pr_material(repo, None).await.unwrap_err(),
            "no commits on this branch to describe"
        );
    }
}
