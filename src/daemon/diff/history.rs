//! Read-only branch history and individual commit patches.
use super::{errline, git, parse::parse_unified, pr_base::pr_merge_base};
use anyhow::{bail, Result};
use std::collections::HashSet;
use warpforge_protocol as wire;

pub async fn branch_commits(repo: &str, base: Option<&str>) -> Result<Vec<wire::GitBranchCommit>> {
    let base = pr_merge_base(repo, base).await;
    let range = base.as_ref().map(|base| format!("{base}..HEAD"));
    let format = "--format=%H%x00%h%x00%s%x00%an%x00%aI";
    let out = match &range {
        Some(range) => git(repo, &["log", format, range, "--"]).await?,
        None => {
            git(
                repo,
                &[
                    "log",
                    format,
                    "HEAD",
                    "--not",
                    "--remotes",
                    "-n",
                    "100",
                    "--",
                ],
            )
            .await?
        }
    };
    if !out.status.success() {
        bail!("{}", errline(&out));
    }
    let unpushed: Option<HashSet<String>> = if let Some(range) = &range {
        let unpushed = git(repo, &["rev-list", range, "--not", "@{upstream}", "--"]).await?;
        unpushed.status.success().then(|| {
            String::from_utf8_lossy(&unpushed.stdout)
                .lines()
                .map(str::to_owned)
                .collect()
        })
    } else {
        None
    };
    let mut commits = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let fields: Vec<_> = line.split('\0').collect();
        if fields.len() != 5 {
            continue;
        }
        let pushed = unpushed
            .as_ref()
            .is_some_and(|unpushed| !unpushed.contains(fields[0]));
        commits.push(wire::GitBranchCommit {
            hash: fields[0].into(),
            short_hash: fields[1].into(),
            subject: fields[2].into(),
            author: fields[3].into(),
            date: fields[4].into(),
            pushed,
        });
    }
    Ok(commits)
}

pub async fn commit_diff(repo: &str, hash: &str) -> Result<Vec<wire::FileDiff>> {
    if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("expected a full commit hash");
    }
    let out = git(
        repo,
        &[
            "show",
            "--format=",
            "--first-parent",
            "--root",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            hash,
            "--",
        ],
    )
    .await?;
    if !out.status.success() {
        bail!("{}", errline(&out));
    }
    Ok(parse_unified(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::diff::testsupport::{git, init_repo};

    #[tokio::test]
    async fn history_uses_base_and_marks_only_upstream_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        init_repo(d).await;
        git(d, &["checkout", "-qb", "main"]).await;
        std::fs::write(d.join("a"), "base\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-qm", "base"]).await;
        git(d, &["checkout", "-qb", "feature"]).await;
        std::fs::write(d.join("a"), "first\n").unwrap();
        git(d, &["commit", "-qam", "first"]).await;
        git(d, &["update-ref", "refs/remotes/origin/feature", "HEAD"]).await;
        git(d, &["config", "remote.origin.url", "."]).await;
        git(
            d,
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        )
        .await;
        git(d, &["config", "branch.feature.remote", "origin"]).await;
        git(d, &["config", "branch.feature.merge", "refs/heads/feature"]).await;
        std::fs::write(d.join("a"), "second\n").unwrap();
        git(d, &["commit", "-qam", "second"]).await;
        let repo = d.to_str().unwrap();
        let commits = branch_commits(repo, Some("main")).await.unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second");
        assert!(!commits[0].pushed);
        assert!(commits[1].pushed);
        let patch = commit_diff(repo, &commits[0].hash).await.unwrap();
        assert_eq!(patch.len(), 1);
        assert_eq!(patch[0].path, "a");
        assert!(patch[0].hunks[0].lines.contains(&"-first".into()));
        assert!(patch[0].hunks[0].lines.contains(&"+second".into()));
        assert!(commit_diff(repo, "--all").await.is_err());
        assert!(commit_diff(repo, &"0".repeat(40)).await.is_err());
        git(d, &["config", "--unset", "branch.feature.remote"]).await;
        assert!(branch_commits(repo, Some("main"))
            .await
            .unwrap()
            .iter()
            .all(|c| !c.pushed));
    }

    #[tokio::test]
    async fn history_without_a_base_lists_only_local_commits() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        init_repo(d).await;
        std::fs::write(d.join("a"), "base").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-qm", "base"]).await;
        let repo = d.to_str().unwrap();
        let commits = branch_commits(repo, None).await.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "base");
        assert!(!commits[0].pushed);
        git(d, &["update-ref", "refs/remotes/origin/feature", "HEAD"]).await;
        std::fs::write(d.join("a"), "local").unwrap();
        git(d, &["commit", "-qam", "local"]).await;
        let commits = branch_commits(repo, None).await.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "local");
        assert!(!commits[0].pushed);
    }

    #[tokio::test]
    async fn root_commit_patch_includes_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        init_repo(d).await;
        std::fs::write(d.join("new"), "hello\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-qm", "root"]).await;
        let repo = d.to_str().unwrap();
        let hash = super::super::rev_parse_head(repo).await.unwrap();
        let patch = commit_diff(repo, &hash).await.unwrap();
        assert_eq!(patch[0].status, wire::FileDiffStatus::Added);
    }
}
