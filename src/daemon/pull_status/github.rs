//! Asking GitHub for the pull request of a worktree's current branch.

use anyhow::{anyhow, Result};
use serde::Deserialize;
use warpforge_protocol as wire;

use super::checks::rollup;
use super::PullTarget;
use crate::daemon::tracker::{github_graphql, github_owner_repo, parse_checks};

/// Enough rows that an open pull request is not hidden behind older closed
/// ones reusing the same branch name.
const LIST_LIMIT: u64 = 10;

const QUERY: &str = "query($owner: String!, $repo: String!, $head: String!, $first: Int!) { \
   repository(owner: $owner, name: $repo) { \
     pullRequests(headRefName: $head, first: $first, \
       orderBy: {field: CREATED_AT, direction: DESC}) { nodes { \
       number title url state isDraft headRefOid updatedAt author { login } \
       commits(last: 1) { nodes { commit { statusCheckRollup { \
         contexts(first: 100) { nodes { \
           __typename \
           ... on CheckRun { name status conclusion detailsUrl \
             checkSuite { workflowRun { workflow { name } } } } \
           ... on StatusContext { context state targetUrl description } \
         } } } } } } } } } }";

/// A pull request as the listing reports it, plus the timestamp that says
/// whether its conversation needs reading again.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Listed {
    pub pull: wire::TaskPullRequest,
    /// GitHub's `updatedAt`: a comment or review moves it, a check does not.
    pub updated_at: String,
}

/// The pull request whose head is the worktree's current branch, or `None`
/// when there is none, the checkout is detached, or it sits on its base branch.
pub(super) async fn fetch(target: PullTarget) -> Result<Option<Listed>> {
    let branch = match target.head.clone() {
        Some(head) => head,
        None => match crate::daemon::diff::current_branch(&target.worktree).await {
            Some(branch) => branch,
            None => return Ok(None),
        },
    };
    if target.base_branch.as_deref() == Some(branch.as_str()) {
        return Ok(None);
    }
    let (owner, repo) = github_owner_repo(&target.worktree).await?;
    let payload = github_graphql(
        QUERY,
        serde_json::json!({"owner": owner, "repo": repo, "head": branch, "first": LIST_LIMIT}),
    )
    .await?;
    let nodes = payload
        .pointer("/data/repository/pullRequests/nodes")
        .ok_or_else(|| anyhow!("GitHub has no repository {owner}/{repo} here"))?;
    parse_pull_list(nodes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPull {
    number: u64,
    title: String,
    url: String,
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    head_ref_oid: Option<String>,
    #[serde(default)]
    author: Option<RawAuthor>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[derive(Deserialize)]
struct RawAuthor {
    #[serde(default)]
    login: String,
}

/// Pick the branch's open pull request, else its most recent one. The query
/// lists newest first.
pub(super) fn parse_pull_list(nodes: &serde_json::Value) -> Result<Option<Listed>> {
    let nodes = nodes.as_array().cloned().unwrap_or_default();
    let chosen = nodes
        .iter()
        .position(|node| node.get("state").and_then(|s| s.as_str()) == Some("OPEN"))
        .or((!nodes.is_empty()).then_some(0));
    let Some(node) = chosen.and_then(|index| nodes.into_iter().nth(index)) else {
        return Ok(None);
    };
    let runs = parse_checks(&node)?;
    let pull: RawPull = serde_json::from_value(node)?;
    let state = match pull.state.as_str() {
        "OPEN" if pull.is_draft => wire::TaskPullState::Draft,
        "OPEN" => wire::TaskPullState::Open,
        "MERGED" => wire::TaskPullState::Merged,
        _ => wire::TaskPullState::Closed,
    };
    let checks = rollup(&runs);
    let failed_checks = runs
        .into_iter()
        .filter(|run| run.state == wire::PullChecks::Failing)
        .collect();
    Ok(Some(Listed {
        pull: wire::TaskPullRequest {
            number: pull.number,
            title: pull.title,
            url: pull.url,
            state,
            checks,
            head_oid: pull.head_ref_oid.filter(|oid| !oid.is_empty()),
            author: pull
                .author
                .map(|author| author.login)
                .filter(|login| !login.is_empty()),
            failed_checks,
            open_comments: Vec::new(),
        },
        updated_at: pull.updated_at.unwrap_or_default(),
    }))
}
