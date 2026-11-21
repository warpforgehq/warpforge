//! The detail body and the changes: file stats via GraphQL, the raw unified
//! patch from the diff endpoint.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use super::super::http::{github_graphql, rest_text};
use super::super::repo::github_owner_repo;
use super::{actor_avatar, cap_patch};
use warpforge_protocol as wire;

/// The body-level fields of one pull request, in one round trip.
pub(crate) async fn github_pr_details(
    repo_dir: &str,
    number: u64,
) -> Result<wire::PullRequestDetails> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_graphql(
        "query($owner: String!, $repo: String!, $number: Int!) { \
           repository(owner: $owner, name: $repo) { \
             pullRequest(number: $number) { \
               title url state isDraft updatedAt body author { login } \
               baseRefName headRefName reviewDecision \
               reviewRequests(first: 10) { nodes { requestedReviewer { \
                 ... on User { login } } } } \
               additions deletions changedFiles } } }",
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    let pr = payload
        .pointer("/data/repository/pullRequest")
        .filter(|node| !node.is_null())
        .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))?;
    let author = pr
        .pointer("/author/login")
        .and_then(|login| login.as_str())
        .and_then(|login| {
            (!login.trim().is_empty()).then(|| wire::PullActor {
                login: login.trim().to_string(),
                avatar_url: actor_avatar(login),
            })
        });
    // Team review requests carry no `login`, so only users survive the filter.
    let review_requests = pr
        .pointer("/reviewRequests/nodes")
        .and_then(|nodes| nodes.as_array())
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|node| node.pointer("/requestedReviewer/login"))
                .filter_map(|login| login.as_str())
                .map(str::trim)
                .filter(|login| !login.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(wire::PullRequestDetails {
        updated_at: pr
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .map(crate::daemon::tracker::rfc3339_secs)
            .unwrap_or_default(),
        title: pr
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        url: pr
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        state: pr
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("OPEN")
            .to_lowercase(),
        draft: pr.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false),
        body: pr
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        author,
        base_ref_name: pr
            .get("baseRefName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        head_ref_name: pr
            .get("headRefName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        review_decision: pr
            .get("reviewDecision")
            .filter(|v| !v.is_null())
            .and_then(|v| v.as_str())
            .map(str::to_string),
        review_requests,
        additions: pr.get("additions").and_then(|v| v.as_u64()).unwrap_or(0),
        deletions: pr.get("deletions").and_then(|v| v.as_u64()).unwrap_or(0),
        changed_files: pr.get("changedFiles").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawDiffMeta {
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
    #[serde(default)]
    files: RawDiffNodes,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawDiffNodes {
    #[serde(default)]
    nodes: Vec<RawDiffFile>,
}

#[derive(Deserialize, Default)]
struct RawDiffFile {
    #[serde(default)]
    path: String,
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
}

/// File stats via GraphQL, the raw unified patch via the diff endpoint
/// (`application/vnd.github.diff`). The two are separate because the patch is the heavy part a
/// client re-fetches far less often than the stats.
pub(crate) async fn github_pr_diff(repo_dir: &str, number: u64) -> Result<wire::PullRequestDiff> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let meta_payload = github_graphql(
        "query($owner: String!, $repo: String!, $number: Int!) { \
           repository(owner: $owner, name: $repo) { \
             pullRequest(number: $number) { \
               additions deletions \
               files(first: 100) { nodes { path additions deletions } } } } }",
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    let meta: RawDiffMeta = serde_json::from_value(
        meta_payload
            .pointer("/data/repository/pullRequest")
            .cloned()
            .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))?,
    )
    .context("parsing pull request file stats")?;

    let (patch, truncated) = cap_patch(fetch_pr_patch(&owner, &repo, number).await?);
    let (additions, deletions) = if meta.additions == 0 && meta.deletions == 0 {
        let additions = meta.files.nodes.iter().map(|file| file.additions).sum();
        let deletions = meta.files.nodes.iter().map(|file| file.deletions).sum();
        (additions, deletions)
    } else {
        (meta.additions, meta.deletions)
    };
    Ok(wire::PullRequestDiff {
        additions,
        deletions,
        files: meta
            .files
            .nodes
            .into_iter()
            .map(|file| wire::PullRequestFile {
                path: file.path,
                additions: file.additions,
                deletions: file.deletions,
            })
            .collect(),
        patch,
        truncated,
    })
}

async fn fetch_pr_patch(owner: &str, repo: &str, number: u64) -> Result<String> {
    rest_text(
        &format!("repos/{owner}/{repo}/pulls/{number}"),
        "application/vnd.github.diff",
    )
    .await
    .context("pull request diff request")
}
