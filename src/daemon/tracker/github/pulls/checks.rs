//! The checks on a pull request's head commit, for the review pane's rail.
//! Its own query rather than a field on the detail read: a token that may
//! read pull requests but not checks must not lose the whole pane.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use super::super::http::github_graphql;
use super::super::repo::github_owner_repo;
use crate::daemon::pull_status::{check_name, check_state};
use warpforge_protocol as wire;

/// The head commit's checks in the shape [`parse_checks`] reads. Every query
/// that feeds it selects this fragment, so the two cannot drift apart.
pub(crate) const HEAD_CHECKS: &str = "commits(last: 1) { nodes { commit { statusCheckRollup { \
     contexts(first: 100) { nodes { \
       __typename \
       ... on CheckRun { name status conclusion detailsUrl \
         checkSuite { workflowRun { workflow { name } } } } \
       ... on StatusContext { context state targetUrl description } \
     } } } } } }";

fn checks_query() -> String {
    format!(
        "query($owner: String!, $repo: String!, $number: Int!) {{ \
           repository(owner: $owner, name: $repo) {{ \
             pullRequest(number: $number) {{ {HEAD_CHECKS} }} }} }}"
    )
}

/// Every check on the head commit, in GitHub's order.
pub(crate) async fn github_pr_checks(
    repo_dir: &str,
    number: u64,
) -> Result<Vec<wire::PullCheckRun>> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_graphql(
        &checks_query(),
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    let pr = payload
        .pointer("/data/repository/pullRequest")
        .filter(|node| !node.is_null())
        .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))?;
    parse_checks(pr)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawContext {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    conclusion: Option<String>,
    #[serde(default)]
    details_url: Option<String>,
    #[serde(default)]
    check_suite: Option<serde_json::Value>,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    target_url: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

pub(crate) fn parse_checks(pr: &serde_json::Value) -> Result<Vec<wire::PullCheckRun>> {
    let Some(nodes) = pr
        .pointer("/commits/nodes/0/commit/statusCheckRollup/contexts/nodes")
        .filter(|nodes| !nodes.is_null())
    else {
        return Ok(Vec::new());
    };
    let raw: Vec<RawContext> =
        serde_json::from_value(nodes.clone()).context("parsing pull request checks")?;
    Ok(raw
        .into_iter()
        .map(|node| {
            let workflow = node
                .check_suite
                .as_ref()
                .and_then(|suite| suite.pointer("/workflowRun/workflow/name"))
                .and_then(|name| name.as_str())
                .unwrap_or_default();
            wire::PullCheckRun {
                name: check_name(
                    node.name.as_deref().unwrap_or_default(),
                    workflow,
                    node.context.as_deref().unwrap_or_default(),
                ),
                state: check_state(
                    node.status.as_deref(),
                    node.conclusion.as_deref(),
                    node.state.as_deref(),
                ),
                url: node
                    .details_url
                    .filter(|url| !url.is_empty())
                    .or(node.target_url)
                    .unwrap_or_default(),
                summary: node.description.unwrap_or_default().trim().to_string(),
            }
        })
        .collect())
}
