//! Talking to the forge: what a push would send (`push_info`), the push
//! itself, and opening a pull request through the `gh` CLI.

use anyhow::{anyhow, bail, Result};
use tokio::process::Command;
use warpforge_protocol as wire;

use super::working::current_branch;
use super::{errline, git, op_error};

/// Run `gh` in `repo`, mapping a missing binary to a friendly message.
async fn gh(repo: &str, args: &[&str]) -> Result<std::process::Output> {
    Command::new("gh")
        .current_dir(repo)
        .args(args)
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                anyhow!(
                    "GitHub CLI (`gh`) is not installed. Install it (`brew install gh`) and run \
                     `gh auth login`."
                )
            } else {
                anyhow!(e)
            }
        })
}

fn friendly_gh_error(stderr: &str) -> String {
    let low = stderr.to_lowercase();
    if low.contains("auth") || low.contains("not logged in") || low.contains("gh auth login") {
        return format!(
            "GitHub CLI is not authenticated. Run `gh auth login` and retry. ({stderr})"
        );
    }
    if stderr.trim().is_empty() {
        "gh pr create failed".to_string()
    } else {
        format!("gh pr create failed: {}", stderr.trim())
    }
}

/// `git.createPr`: open a GitHub pull request for the current branch via `gh`.
/// Requires `gh` on PATH and authenticated. Returns the PR URL. If a PR for the
/// branch already exists, returns its URL instead of erroring.
pub async fn create_pr(repo: &str, title: &str, body: &str, base: Option<&str>) -> Result<String> {
    let branch = current_branch(repo)
        .await
        .ok_or_else(|| anyhow!("not on a branch (detached HEAD or not a git repo)"))?;

    let mut args: Vec<&str> = vec!["pr", "create", "--head", &branch, "--title", title];
    if !body.trim().is_empty() {
        args.push("--body");
        args.push(body);
    } else {
        args.push("--body");
        args.push("");
    }
    let base = base.map(str::trim).filter(|b| !b.is_empty());
    if let Some(base) = base {
        args.push("--base");
        args.push(base);
    }

    let out = gh(repo, &args).await?;
    if out.status.success() {
        // gh prints the PR URL as the last line of stdout.
        let stdout = String::from_utf8_lossy(&out.stdout);
        let url = stdout
            .lines()
            .rev()
            .find(|l| l.contains("://"))
            .unwrap_or("");
        return Ok(url.trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&out.stderr);
    // A branch that already has a PR: surface the existing one instead of failing.
    if stderr.to_lowercase().contains("already exists") {
        if let Ok(view) = gh(repo, &["pr", "view", "--json", "url", "--jq", ".url"]).await {
            if view.status.success() {
                let url = String::from_utf8_lossy(&view.stdout).trim().to_string();
                if !url.is_empty() {
                    return Ok(url);
                }
            }
        }
    }
    Err(anyhow!(friendly_gh_error(&stderr)))
}

/// Build the lightweight push preview used by the desktop dialog. This reads
/// only local refs; opening the dialog never performs network I/O.
pub async fn push_info(repo: &str) -> Result<wire::GitPushInfo> {
    let branch = current_branch(repo)
        .await
        .ok_or_else(|| anyhow!("not on a branch (detached HEAD or not a git repo)"))?;

    let configured_upstream = git(
        repo,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await?;
    let upstream = configured_upstream
        .status
        .success()
        .then(|| {
            String::from_utf8_lossy(&configured_upstream.stdout)
                .trim()
                .to_string()
        })
        .filter(|value| !value.is_empty());

    let remote = if let Some(upstream) = &upstream {
        upstream.split('/').next().unwrap_or("origin").to_string()
    } else {
        let configured = git(
            repo,
            &["config", "--get", &format!("branch.{branch}.remote")],
        )
        .await?;
        let value = String::from_utf8_lossy(&configured.stdout)
            .trim()
            .to_string();
        if configured.status.success() && !value.is_empty() && value != "." {
            value
        } else {
            let origin = git(repo, &["remote", "get-url", "origin"]).await?;
            if origin.status.success() {
                "origin".to_string()
            } else {
                let remotes = git(repo, &["remote"]).await?;
                String::from_utf8_lossy(&remotes.stdout)
                    .lines()
                    .map(str::trim)
                    .find(|name| !name.is_empty())
                    .ok_or_else(|| anyhow!("no git remote configured"))?
                    .to_string()
            }
        }
    };
    let remote_branch = upstream
        .as_deref()
        .and_then(|value| value.strip_prefix(&format!("{remote}/")))
        .unwrap_or(&branch)
        .to_string();
    let target = upstream
        .clone()
        .unwrap_or_else(|| format!("{remote}/{remote_branch}"));

    // Prefer the exact upstream/same-name remote branch. For a brand-new
    // branch, list only commits unreachable from every branch on that remote.
    // This also works when the remote has no symbolic `origin/HEAD` ref.
    let target_exists = git(repo, &["rev-parse", "--verify", "-q", &target]).await?;
    let log = if target_exists.status.success() {
        let range = format!("{target}..HEAD");
        git(
            repo,
            &["log", "--reverse", "--format=%H%x1f%h%x1f%s%x1f%an", &range],
        )
        .await?
    } else {
        let remote_refs = format!("--remotes={remote}");
        git(
            repo,
            &[
                "log",
                "--reverse",
                "--format=%H%x1f%h%x1f%s%x1f%an",
                "HEAD",
                "--not",
                &remote_refs,
            ],
        )
        .await?
    };
    if !log.status.success() {
        bail!("git log failed: {}", errline(&log));
    }
    let mut commits = Vec::new();
    for line in String::from_utf8_lossy(&log.stdout).lines() {
        let mut fields = line.splitn(4, '\u{1f}');
        let Some(hash) = fields.next().filter(|value| !value.is_empty()) else {
            continue;
        };
        let short_hash = fields.next().unwrap_or(hash).to_string();
        let subject = fields.next().unwrap_or_default().to_string();
        let author = fields.next().unwrap_or_default().to_string();
        let changed = git(
            repo,
            &[
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--name-status",
                "-r",
                "-M",
                hash,
            ],
        )
        .await?;
        let files = String::from_utf8_lossy(&changed.stdout)
            .lines()
            .filter_map(|line| {
                let mut parts = line.split('\t');
                let raw_status = parts.next()?.trim();
                let first_path = parts.next()?.trim();
                let path = if raw_status.starts_with('R') || raw_status.starts_with('C') {
                    parts.next().unwrap_or(first_path).trim()
                } else {
                    first_path
                };
                (!path.is_empty()).then(|| wire::GitPushFile {
                    path: path.to_string(),
                    status: raw_status.chars().next().unwrap_or('M').to_string(),
                })
            })
            .collect();
        commits.push(wire::GitPushCommit {
            hash: hash.to_string(),
            short_hash,
            subject,
            author,
            files,
        });
    }

    Ok(wire::GitPushInfo {
        branch,
        remote,
        remote_branch,
        upstream: target,
        has_upstream: upstream.is_some(),
        commits,
    })
}

/// Push the current branch, creating its upstream when necessary. Force push
/// deliberately means `--force-with-lease`: the modal should not overwrite
/// remote work that appeared since the last fetch.
pub async fn push(repo: &str, force: bool) -> Result<wire::GitOpResult> {
    let info = push_info(repo).await?;
    if info.commits.is_empty() {
        return Ok(wire::GitOpResult {
            status: wire::GitOpStatus::UpToDate,
            message: format!("'{}' is already up to date", info.branch),
            conflicts: Vec::new(),
            branch: Some(info.branch),
        });
    }

    let mut args = vec!["push"];
    if force {
        args.push("--force-with-lease");
    }
    if !info.has_upstream {
        args.extend(["--set-upstream", info.remote.as_str(), info.branch.as_str()]);
    }
    let out = git(repo, &args).await?;
    if !out.status.success() {
        return Ok(op_error(format!("git push failed: {}", errline(&out))));
    }
    Ok(wire::GitOpResult {
        status: wire::GitOpStatus::Ok,
        message: format!(
            "pushed '{}' to '{}'{}",
            info.branch,
            info.upstream,
            if force { " with force-with-lease" } else { "" }
        ),
        conflicts: Vec::new(),
        branch: Some(info.branch),
    })
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::git;
    use super::*;

    #[tokio::test]
    async fn push_preview_lists_outgoing_commits_and_first_push_sets_upstream() {
        let root = std::env::temp_dir().join(format!("wf-push-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin.git");
        let origin_url = origin.to_str().unwrap();

        git(&root, &["init", "--bare", "-q", origin_url]).await;
        git(&root, &["clone", "-q", origin_url, "work"]).await;
        let work = root.join("work");
        let repo = work.to_str().unwrap();
        git(&work, &["config", "user.email", "t@t"]).await;
        git(&work, &["config", "user.name", "Test Author"]).await;
        std::fs::write(work.join("base.txt"), "base\n").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-q", "-m", "initial"]).await;
        git(&work, &["push", "-q", "-u", "origin", "HEAD"]).await;

        git(&work, &["checkout", "-q", "-b", "feature/push-dialog"]).await;
        std::fs::write(work.join("first.txt"), "first\n").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-q", "-m", "first outgoing"]).await;
        std::fs::write(work.join("second.txt"), "second\n").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-q", "-m", "second outgoing"]).await;

        let preview = push_info(repo).await.unwrap();
        assert_eq!(preview.branch, "feature/push-dialog");
        assert_eq!(preview.upstream, "origin/feature/push-dialog");
        assert!(!preview.has_upstream);
        assert_eq!(preview.commits.len(), 2);
        assert_eq!(preview.commits[0].subject, "first outgoing");
        assert_eq!(preview.commits[0].author, "Test Author");
        assert_eq!(preview.commits[0].files[0].path, "first.txt");
        assert_eq!(preview.commits[1].files[0].path, "second.txt");

        let result = push(repo, false).await.unwrap();
        assert_eq!(result.status, wire::GitOpStatus::Ok, "{}", result.message);
        let after = push_info(repo).await.unwrap();
        assert!(after.has_upstream);
        assert!(after.commits.is_empty());

        std::fs::remove_dir_all(&root).ok();
    }

    // ── tracked / untracked / ignored split ─────────────────────────────────
}
