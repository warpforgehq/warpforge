//! The review verdicts: approve a pull request, request changes on it, or
//! leave a standalone review comment. This is the reviewer's summary verdict,
//! not a line comment — the thread writes live in `comment.rs`.
//!
//! The REST reviews endpoint is used rather than the GraphQL
//! `submitPullRequestReview` mutation: it takes the PR number directly, so no
//! node id has to be resolved first, and one shape serves both transports.

use anyhow::{bail, Context, Result};

use super::super::cli::{body_file, gh, github_owner_repo};
use super::super::{github_token, GITHUB_API};
use crate::daemon::tracker::NETWORK_TIMEOUT;

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
    let api_path = format!("repos/{owner}/{repo}/pulls/{number}/reviews");
    if let Some(token) = github_token() {
        let client = reqwest::Client::new();
        // The body key is simply absent when empty — sending `""` would file
        // an empty summary comment instead of a bare verdict.
        let mut payload = serde_json::json!({ "event": event });
        if !body.is_empty() {
            payload["body"] = body.into();
        }
        let resp = client
            .post(format!("{GITHUB_API}/{api_path}"))
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "warpforge")
            .timeout(NETWORK_TIMEOUT)
            .json(&payload)
            .send()
            .await
            .context("submitting review")?;
        let status = resp.status();
        let value: serde_json::Value = resp.json().await.context("parsing review response")?;
        if !status.is_success() {
            bail!(
                "review failed ({status}): {}",
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown error")
            );
        }
        return review_url(&value)
            .ok_or_else(|| anyhow::anyhow!("GitHub did not return a review URL"));
    }
    // The body travels in a temp file, never argv (ADR-0010 invariant 8);
    // without a body the key is left off entirely.
    let event_arg = format!("event={event}");
    let mut args: Vec<&str> = vec!["api", "-X", "POST", &api_path, "-F", &event_arg];
    let body_file_guard;
    let body_arg;
    if !body.is_empty() {
        body_file_guard = body_file(body)?;
        body_arg = format!("body=@{}", body_file_guard.path().display());
        args.extend(["-F", &body_arg]);
    }
    let out = gh(Some(repo_dir), &args).await?;
    if !out.status.success() {
        bail!(
            "review failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let value: serde_json::Value =
        serde_json::from_slice(&out.stdout).context("parsing review response")?;
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
