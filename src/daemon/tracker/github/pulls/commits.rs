//! The commits of a pull request, and the patch for a slice of them.
//!
//! Reviewing 40 files that arrived in three commits is three reviews, and the
//! only way to read it that way is to diff one commit at a time. GitHub has no
//! "diff of commits i..j" endpoint, but a range of commits *is* a comparison:
//! from the first one's parent to the last one. So the commit list carries
//! each commit's parent (`parent_oid`), the client names a range with two
//! hashes, and this compares them.

#![allow(deprecated)]

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

use super::super::cli::{gh, github_owner_repo};
use super::super::graphql::github_query;
use super::super::{github_token, GITHUB_API};
use super::{cap_patch, RawActor, RawNodes};
use crate::daemon::tracker::NETWORK_TIMEOUT;
use warpforge_protocol as wire;

/// How many commits the picker can offer. GraphQL pages at 100, and `last`
/// rather than `first` because a 150-commit pull request is reviewed at its
/// tip: dropping the oldest 50 costs nothing, dropping the newest 50 would
/// hide the work.
const MAX_PR_COMMITS: u32 = 100;

#[derive(Deserialize, Default)]
struct RawCommitNode {
    #[serde(default)]
    commit: RawCommit,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawCommit {
    #[serde(default)]
    oid: String,
    #[serde(default)]
    abbreviated_oid: String,
    #[serde(default)]
    message_headline: String,
    #[serde(default)]
    committed_date: String,
    #[serde(default)]
    parents: RawNodes<RawParent>,
    #[serde(default)]
    author: RawCommitAuthor,
}

#[derive(Deserialize, Default)]
struct RawParent {
    #[serde(default)]
    oid: String,
}

/// A commit author is a git identity that may or may not be a GitHub account,
/// so the login lives one level down and can be absent entirely.
#[derive(Deserialize, Default)]
struct RawCommitAuthor {
    #[serde(default)]
    user: Option<RawActor>,
}

impl RawCommit {
    fn into_wire(self) -> wire::PullCommit {
        wire::PullCommit {
            author: self.author.user.and_then(RawActor::into_wire),
            abbreviated_oid: self.abbreviated_oid,
            committed_date: self.committed_date,
            message_headline: self.message_headline,
            parent_oid: self
                .parents
                .nodes
                .into_iter()
                .next()
                .map(|parent| parent.oid)
                .unwrap_or_default(),
            oid: self.oid,
        }
    }
}

/// One pull request's commits, oldest first, in one round trip.
pub(crate) async fn github_pr_commits(
    repo_dir: &str,
    number: u64,
) -> Result<Vec<wire::PullCommit>> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_query(
        repo_dir,
        "query($owner: String!, $repo: String!, $number: Int!, $last: Int!) { \
           repository(owner: $owner, name: $repo) { \
             pullRequest(number: $number) { \
               commits(last: $last) { nodes { commit { \
                 oid abbreviatedOid messageHeadline committedDate \
                 parents(first: 1) { nodes { oid } } \
                 author { user { login } } } } } } } }",
        serde_json::json!({
            "owner": owner, "repo": repo, "number": number, "last": MAX_PR_COMMITS,
        }),
    )
    .await?;
    let nodes = payload
        .pointer("/data/repository/pullRequest/commits")
        .cloned()
        .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))?;
    let nodes: RawNodes<RawCommitNode> =
        serde_json::from_value(nodes).context("parsing pull request commits")?;
    Ok(nodes
        .nodes
        .into_iter()
        .map(|node| node.commit.into_wire())
        .filter(|commit| !commit.oid.is_empty())
        .collect())
}

#[derive(Deserialize, Default)]
struct RawCompare {
    #[serde(default)]
    files: Vec<RawCompareFile>,
}

#[derive(Deserialize, Default)]
struct RawCompareFile {
    #[serde(default)]
    filename: String,
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
}

/// The patch between two commits of a pull request: file stats from the
/// comparison's JSON, the unified patch from the same comparison asked for as
/// a diff. Two calls for the same reason the whole-PR diff takes two — the
/// patch is the heavy half and the stats are what the rails render.
pub(crate) async fn github_pr_range_diff(
    repo_dir: &str,
    from_oid: &str,
    to_oid: &str,
) -> Result<wire::PullRequestDiff> {
    if !is_oid(from_oid) || !is_oid(to_oid) {
        bail!("a commit range needs two commit hashes");
    }
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let path = format!("repos/{owner}/{repo}/compare/{from_oid}...{to_oid}");

    let meta: RawCompare = serde_json::from_value(github_get(repo_dir, &path, None).await?)
        .context("parsing commit comparison")?;
    let patch = github_get_text(repo_dir, &path, "application/vnd.github.diff").await?;
    let (patch, truncated) = cap_patch(patch);

    Ok(wire::PullRequestDiff {
        additions: meta.files.iter().map(|file| file.additions).sum(),
        deletions: meta.files.iter().map(|file| file.deletions).sum(),
        files: meta
            .files
            .into_iter()
            .map(|file| wire::PullRequestFile {
                path: file.filename,
                additions: file.additions,
                deletions: file.deletions,
            })
            .collect(),
        patch,
        truncated,
    })
}

/// A commit hash and nothing else. These land in a URL path, and `..`, a
/// slash or a query string in one would address something other than a
/// comparison.
fn is_oid(oid: &str) -> bool {
    let oid = oid.trim();
    (7..=40).contains(&oid.len()) && oid.chars().all(|c| c.is_ascii_hexdigit())
}

async fn github_get(repo_dir: &str, path: &str, accept: Option<&str>) -> Result<serde_json::Value> {
    let text = github_get_text(
        repo_dir,
        path,
        accept.unwrap_or("application/vnd.github+json"),
    )
    .await?;
    serde_json::from_str(&text).context("parsing GitHub response")
}

/// One REST GET on either path: the PAT goes straight out over reqwest, and
/// without one `gh api` answers with the same `Accept`.
async fn github_get_text(repo_dir: &str, path: &str, accept: &str) -> Result<String> {
    if let Some(token) = github_token() {
        let resp = reqwest::Client::new()
            .get(format!("{GITHUB_API}/{path}"))
            .header("Accept", accept)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "warpforge")
            .timeout(NETWORK_TIMEOUT)
            .send()
            .await
            .context("commit comparison request")?
            .error_for_status()
            .context("commit comparison request")?;
        return resp.text().await.context("reading commit comparison");
    }
    let out = gh(
        Some(repo_dir),
        &["api", path, "-H", &format!("Accept: {accept}")],
    )
    .await?;
    if !out.status.success() {
        bail!(
            "commit comparison failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commit_node_maps_onto_the_wire_shape() {
        let raw: RawCommitNode = serde_json::from_value(serde_json::json!({
            "commit": {
                "oid": "f6df470aa1b2c3d4e5f60718293a4b5c6d7e8f90",
                "abbreviatedOid": "f6df470",
                "messageHeadline": "feat(gold-validation): full TIER-A run",
                "committedDate": "2026-06-01T15:29:00Z",
                "parents": { "nodes": [{ "oid": "a2ea713aa1b2c3d4e5f60718293a4b5c6d7e8f90" }] },
                "author": { "user": { "login": "octocat" } },
            }
        }))
        .unwrap();
        let commit = raw.commit.into_wire();
        assert_eq!(commit.abbreviated_oid, "f6df470");
        assert!(commit.parent_oid.starts_with("a2ea713"));
        assert_eq!(commit.author.as_ref().unwrap().login, "octocat");
    }

    #[test]
    fn a_commit_without_a_github_account_keeps_its_hash() {
        let raw: RawCommitNode = serde_json::from_value(serde_json::json!({
            "commit": {
                "oid": "d6a9f40aa1b2c3d4e5f60718293a4b5c6d7e8f90",
                "abbreviatedOid": "d6a9f40",
                "messageHeadline": "docs: add pipeline map",
                "author": { "user": null },
            }
        }))
        .unwrap();
        let commit = raw.commit.into_wire();
        assert!(commit.author.is_none());
        // A root commit has no parent, so it can never be a range base.
        assert!(commit.parent_oid.is_empty());
    }

    #[test]
    fn only_a_commit_hash_can_address_a_comparison() {
        assert!(is_oid("f6df470"));
        assert!(is_oid("f6df470aa1b2c3d4e5f60718293a4b5c6d7e8f90"));
        // A path traversal, a branch name, a query string: all rejected
        // before they can be spliced into the compare URL.
        for bad in [
            "",
            "main",
            "../../user",
            "f6df470/x",
            "f6df470?x=1",
            "zzzzzzz",
        ] {
            assert!(!is_oid(bad), "{bad} must not read as a commit hash");
        }
    }
}
