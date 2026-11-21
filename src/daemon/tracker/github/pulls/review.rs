//! The review verdicts: approve a pull request, request changes on it, or
//! leave a standalone review comment. This is the reviewer's summary verdict,
//! not a line comment — the thread writes live in `comment.rs`.
//!
//! The REST reviews endpoint is used rather than the GraphQL
//! `submitPullRequestReview` mutation: it takes the PR number directly, so no
//! node id has to be resolved first.

use anyhow::{bail, Context, Result};
use reqwest::Method;

use super::super::http::rest_json;
use super::super::repo::github_owner_repo;

/// Submit a review verdict — `APPROVE`, `REQUEST_CHANGES` or `COMMENT` — with
/// an optional summary body. Returns the review's `html_url`.
///
/// `REQUEST_CHANGES` carries a body by GitHub's own rule, so the emptiness is
/// refused here rather than surfaced as an API error. GitHub itself rejects
/// reviewing your own PR or a draft; that error is passed through verbatim,
/// because it is the user's situation, not our bug.
pub(crate) async fn github_pr_review(
    repo_dir: &str,
    number: u64,
    event: &str,
    body: &str,
) -> Result<String> {
    let event = event.trim().to_ascii_uppercase();
    if !matches!(event.as_str(), "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
        bail!("unsupported review event {event:?}");
    }
    let body = body.trim();
    if event == "REQUEST_CHANGES" && body.is_empty() {
        bail!("requesting changes needs a summary comment");
    }
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    // The body key is simply absent when empty — sending `""` would file an
    // empty summary comment instead of a bare verdict.
    let mut payload = serde_json::json!({ "event": event });
    if !body.is_empty() {
        payload["body"] = body.into();
    }
    let value = rest_json(
        Method::POST,
        &format!("repos/{owner}/{repo}/pulls/{number}/reviews"),
        Some(&payload),
    )
    .await
    .context("review failed")?;
    review_url(&value).ok_or_else(|| anyhow::anyhow!("GitHub did not return a review URL"))
}

/// The review's page URL, which is what the caller can open or show.
fn review_url(value: &serde_json::Value) -> Option<String> {
    value
        .get("html_url")
        .and_then(|url| url.as_str())
        .filter(|url| !url.trim().is_empty())
        .map(str::to_string)
}
