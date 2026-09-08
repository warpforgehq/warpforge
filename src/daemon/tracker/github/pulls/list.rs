//! The inbox listing: one GraphQL round trip per repo, filters applied
//! daemon-side.

#![allow(deprecated)]

use anyhow::{anyhow, Result};
use serde::Deserialize;

use super::super::cli::github_owner_repo;
use super::super::graphql::github_query;
use super::{viewer_login, RawActor, RawLabel, RawNodes};
use crate::daemon::tracker::rfc3339_secs;
use warpforge_protocol as wire;

/// The PR listing query. `states` is interpolated rather than passed as a
/// variable for the same reason the issue query interpolates its state list:
/// `gh` sends every `-f` as a string and the field takes a list of enums.
/// Both values are ours, not a caller's, so there is nothing to inject.
pub(super) fn pulls_query(states: &str) -> String {
    format!(
        "query($owner: String!, $repo: String!, $first: Int!) {{ \
           repository(owner: $owner, name: $repo) {{ \
             pullRequests(first: $first, states: {states}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ \
               nodes {{ number title url state isDraft createdAt updatedAt \
                 additions deletions changedFiles \
                 author {{ login }} \
                 baseRefName headRefName reviewDecision \
                 labels(first: 10) {{ nodes {{ name color }} }} \
                 assignees(first: 5) {{ nodes {{ login }} }} }} }} }} }}"
    )
}

/// One `pullRequests` node, as the listing query emits it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawPull {
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    author: Option<RawActor>,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    labels: RawNodes<RawLabel>,
    #[serde(default)]
    assignees: RawNodes<RawActor>,
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
    #[serde(default)]
    changed_files: u64,
}

impl RawPull {
    pub(super) fn into_wire(self, repo: &str) -> Option<wire::PullRequestSummary> {
        Some(wire::PullRequestSummary {
            project: String::new(),
            repo: repo.to_string(),
            number: self.number,
            title: self.title,
            url: self.url,
            state: self.state.to_lowercase(),
            draft: self.is_draft,
            author: self.author.and_then(RawActor::into_wire),
            labels: self
                .labels
                .nodes
                .into_iter()
                .map(|label| wire::PullLabel {
                    name: label.name,
                    color: label.color.filter(|color| !color.trim().is_empty()),
                })
                .collect(),
            assignees: self
                .assignees
                .nodes
                .into_iter()
                .filter_map(|actor| actor.into_wire().map(|actor| actor.login))
                .collect(),
            base_ref_name: self.base_ref_name,
            head_ref_name: self.head_ref_name,
            review_decision: self.review_decision,
            created_at: rfc3339_secs(&self.created_at),
            updated_at: rfc3339_secs(&self.updated_at),
            additions: self.additions,
            deletions: self.deletions,
            changed_files: self.changed_files,
        })
    }
}

/// List a repo's pull requests, newest update first. `state` is `open` (the
/// inbox's default: closed PRs are archive material) or `all`. `assigned_to_me`
/// and `search` filter daemon-side — a repo's open PRs are a bounded list, so
/// one query and a filter beats a second round trip through the Search API.
pub(crate) async fn github_pr_list(
    repo_dir: &str,
    state: &str,
    assigned_to_me: bool,
    search: &str,
    limit: u32,
) -> Result<Vec<wire::PullRequestSummary>> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let states = if state.eq_ignore_ascii_case("all") {
        "[OPEN, CLOSED, MERGED]"
    } else {
        "[OPEN]"
    };
    let payload = github_query(
        repo_dir,
        &pulls_query(states),
        serde_json::json!({"owner": owner, "repo": repo, "first": limit.clamp(1, 100)}),
    )
    .await?;
    let nodes = payload
        .pointer("/data/repository/pullRequests/nodes")
        .and_then(|value| value.as_array())
        .ok_or_else(|| anyhow!("GitHub pull request query returned no pull requests"))?;
    let viewer = if assigned_to_me {
        Some(viewer_login(repo_dir).await?)
    } else {
        None
    };
    let needle = search.trim().to_lowercase();
    let mut items: Vec<wire::PullRequestSummary> = nodes
        .iter()
        .filter_map(|node| {
            let raw: RawPull = serde_json::from_value(node.clone()).ok()?;
            raw.into_wire(&format!("{owner}/{repo}"))
        })
        .filter(|pr| {
            viewer
                .as_ref()
                .is_none_or(|me| pr.assignees.iter().any(|a| a.eq_ignore_ascii_case(me)))
        })
        .filter(|pr| {
            needle.is_empty()
                || pr.title.to_lowercase().contains(&needle)
                || pr.number.to_string().contains(&needle)
        })
        .collect();
    // Newest first is what the query asked for; the client-side filters can
    // only shrink the list, so the order survives them.
    items.sort_by_key(|pr| std::cmp::Reverse(pr.updated_at));
    Ok(items)
}
