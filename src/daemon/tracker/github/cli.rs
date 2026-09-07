//! The `gh` CLI shim, the repo identity it resolves, and the temp file long
//! bodies travel in.

#![allow(clippy::question_mark)]
#![allow(deprecated)]

use anyhow::{anyhow, bail, Result};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::process::Command;

use crate::daemon::tracker::NETWORK_TIMEOUT;

/// Run `gh` — **deprecated for backlog only** when no PAT is configured.
/// Backlog prefers `github_token()` + `reqwest`; `gh` remains required for
/// `diff.rs` PR flows (`gh pr create/view`). This fallback will be removed for
/// backlog in a future version.
#[deprecated(
    note = "Backlog: use PAT via github_token() + reqwest; gh CLI remains for PRs in diff.rs"
)]
pub(super) async fn gh(repo: Option<&str>, args: &[&str]) -> Result<std::process::Output> {
    let mut cmd = Command::new("gh");
    if let Some(dir) = repo {
        cmd.current_dir(dir);
    }
    cmd.args(args);
    // Without a TTY, `gh` and `git` still pipe long output through a pager that
    // nothing can quit, and still prompt for credentials nothing can type. Both
    // block until the timeout fires, so neither is left to the environment.
    cmd.env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0");
    cmd.kill_on_drop(true);
    let run = cmd.output();
    match tokio::time::timeout(NETWORK_TIMEOUT, run).await {
        Err(_) => bail!("`gh {}` timed out", args.first().copied().unwrap_or("")),
        Ok(result) => result.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                anyhow!("GitHub CLI (`gh`) is not installed. Install it (`brew install gh`).")
            } else {
                anyhow!(e)
            }
        }),
    }
}

/// A markdown body `gh` should read from a file rather than from argv. A comment
/// or issue body can be longer than the argv limit, and an inline one is visible
/// in the process listing. The file is deleted when the handle drops, so it must
/// outlive the `gh` call.
pub(super) fn body_file(body: &str) -> Result<tempfile::NamedTempFile> {
    let mut file = tempfile::Builder::new()
        .prefix("warpforge-body-")
        .suffix(".md")
        .tempfile()?;
    file.write_all(body.as_bytes())?;
    file.flush()?;
    Ok(file)
}

/// Resolving `owner/repo` costs a `git` subprocess (and a `gh` one when the
/// remote is not a github.com URL), and every issue call opens with it. The
/// remote of a checkout effectively never changes, so a short-lived cache
/// collapses a burst of calls into one lookup.
const OWNER_REPO_TTL: Duration = Duration::from_secs(60);

/// Keyed by repo directory: when it was resolved, and the `owner`/`repo` it is.
type OwnerRepoCache = HashMap<String, (Instant, (String, String))>;

static OWNER_REPO_CACHE: Mutex<Option<OwnerRepoCache>> = Mutex::new(None);

/// Resolve `owner/repo` from the given git directory's origin remote.
pub(crate) async fn github_owner_repo(repo_dir: &str) -> Result<(String, String)> {
    if let Some(hit) = cached_owner_repo(repo_dir) {
        return Ok(hit);
    }
    let resolved = resolve_owner_repo(repo_dir).await?;
    // Only a success is cached: a failure is usually a setup problem the user is
    // about to fix, and re-asking after the fix should not wait out the TTL.
    if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
        guard
            .get_or_insert_with(OwnerRepoCache::new)
            .insert(repo_dir.to_string(), (Instant::now(), resolved.clone()));
    }
    Ok(resolved)
}

fn cached_owner_repo(repo_dir: &str) -> Option<(String, String)> {
    let mut guard = OWNER_REPO_CACHE.lock().ok()?;
    let cache = guard.as_mut()?;
    cache.retain(|_, (at, _)| at.elapsed() < OWNER_REPO_TTL);
    cache.get(repo_dir).map(|(_, name)| name.clone())
}

async fn resolve_owner_repo(repo_dir: &str) -> Result<(String, String)> {
    // Prefer git remote directly — works with token and without gh.
    if let Ok(out) = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .args(["remote", "get-url", "origin"])
        .output()
        .await
    {
        if out.status.success() {
            let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some((o, r)) = parse_github_remote(&url) {
                return Ok((o, r));
            }
        }
    }
    let out = gh(
        Some(repo_dir),
        &[
            "repo",
            "view",
            "--json",
            "nameWithOwner",
            "--jq",
            ".nameWithOwner",
        ],
    )
    .await?;
    if !out.status.success() {
        bail!(
            "could not determine GitHub repo here: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (owner, repo) = name
        .split_once('/')
        .ok_or_else(|| anyhow!("unexpected repo name: {name}"))?;
    Ok((owner.to_string(), repo.to_string()))
}

fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    // git@github.com:owner/repo.git  or https://github.com/owner/repo(.git)
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = url.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = url.strip_prefix("http://github.com/") {
        rest
    } else {
        return None;
    };
    let path = path
        .strip_suffix(".git")
        .unwrap_or(path)
        .trim_end_matches('/');
    let (o, r) = path.split_once('/')?;
    Some((o.to_string(), r.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_body_reaches_gh_through_a_file_that_dies_with_its_handle() {
        let file = body_file("# title\n\nbody with \"quotes\" and $vars\n").unwrap();
        let path = file.path().to_path_buf();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# title\n\nbody with \"quotes\" and $vars\n"
        );
        drop(file);
        assert!(!path.exists(), "temp body must not outlive the gh call");
    }

    #[test]
    fn the_owner_repo_cache_answers_until_the_ttl_passes() {
        let dir = "/tmp/warpforge-owner-repo-cache-test";
        if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
            guard.get_or_insert_with(OwnerRepoCache::new).insert(
                dir.to_string(),
                (Instant::now(), ("acme".into(), "widgets".into())),
            );
        }
        assert_eq!(
            cached_owner_repo(dir),
            Some(("acme".into(), "widgets".into()))
        );

        let Some(expired) = Instant::now().checked_sub(OWNER_REPO_TTL + Duration::from_secs(1))
        else {
            return;
        };
        if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
            guard.get_or_insert_with(OwnerRepoCache::new).insert(
                dir.to_string(),
                (expired, ("acme".into(), "widgets".into())),
            );
        }
        assert_eq!(
            cached_owner_repo(dir),
            None,
            "a stale entry must be dropped"
        );
    }
}
