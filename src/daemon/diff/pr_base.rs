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
/// Falls back to the commits not yet pushed when no PR base resolves.
///
/// @param repo Path of the checkout.
/// @param base The task's base branch, when known.
/// @returns `(subjects, diff)`, or an error when the branch has nothing to describe.
pub(crate) async fn pr_material(
    repo: &str,
    base: Option<&str>,
) -> Result<(String, String), String> {
    let (subjects, range) = match pr_merge_base(repo, base).await {
        Some(sha) => {
            let range = format!("{sha}..HEAD");
            let log = git(repo, &["log", "--reverse", "--format=- %s", &range])
                .await
                .map_err(|e| e.to_string())?;
            let subjects = String::from_utf8_lossy(&log.stdout).trim().to_string();
            if subjects.is_empty() {
                return Err("no commits on this branch to describe".to_string());
            }
            (subjects, range)
        }
        None => {
            let info = super::push_info(repo).await.map_err(|e| e.to_string())?;
            let Some(first) = info.commits.first() else {
                return Err("no outgoing commits to describe".to_string());
            };
            let subjects = info
                .commits
                .iter()
                .map(|c| format!("- {}", c.subject))
                .collect::<Vec<_>>()
                .join("\n");
            (subjects, format!("{}^..HEAD", first.hash))
        }
    };
    let diff = git(repo, &["diff", &range])
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    Ok((subjects, diff))
}
