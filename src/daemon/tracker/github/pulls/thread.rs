//! The conversation: comments, reviews and inline review threads, answered
//! by one GraphQL query and folded into one time-ordered list.

#![allow(deprecated)]

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use super::super::cli::github_owner_repo;
use super::super::graphql::{github_query, GITHUB_PR_THREAD_QUERY};
use super::{actor_avatar, RawActor, RawNodes};
use warpforge_protocol as wire;

/// The conversation, parsed out of the single-query payload
/// [`GITHUB_PR_THREAD_QUERY`] answers with. A thread's replies nest under its
/// first comment; everything else sits flat, sorted by time.
pub(crate) async fn github_pr_conversation(
    repo_dir: &str,
    number: u64,
) -> Result<wire::PullThread> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_query(
        repo_dir,
        GITHUB_PR_THREAD_QUERY,
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    let pr = payload
        .pointer("/data/repository/pullRequest")
        .filter(|node| !node.is_null())
        .cloned()
        .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))?;
    parse_pr_thread(&pr)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawThread {
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    comments: RawNodes<RawThreadComment>,
    #[serde(default)]
    reviews: RawNodes<RawReview>,
    #[serde(default)]
    review_threads: RawNodes<RawThreadNode>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawThreadComment {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<RawActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    line: Option<u64>,
    #[serde(default)]
    original_line: Option<u64>,
    #[serde(default)]
    start_line: Option<u64>,
    #[serde(default)]
    original_start_line: Option<u64>,
    #[serde(default)]
    diff_hunk: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawReview {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<RawActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    submitted_at: Option<String>,
    #[serde(default)]
    url: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawThreadNode {
    #[serde(default)]
    id: String,
    #[serde(default)]
    is_resolved: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    comments: RawNodes<RawThreadComment>,
}

fn thread_comment_into(
    comment: RawThreadComment,
    kind: &str,
    fallback_path: &str,
    resolved: bool,
) -> Option<wire::PullComment> {
    if comment.is_minimized {
        return None;
    }
    let created_at = comment.created_at.trim().to_string();
    let author_login = comment.author.unwrap_or_default().login.trim().to_string();
    // A node id is the reply anchor; a missing one gets a stable stand-in so
    // the client can still key the row.
    let id = if comment.id.trim().is_empty() {
        format!("{kind}:{}:{created_at}", author_login)
    } else {
        comment.id.trim().to_string()
    };
    Some(wire::PullComment {
        id,
        kind: kind.to_string(),
        author: (!author_login.is_empty()).then(|| wire::PullActor {
            login: author_login.clone(),
            avatar_url: actor_avatar(&author_login),
        }),
        body: comment.body,
        created_at,
        url: comment.url,
        state: String::new(),
        path: if comment.path.trim().is_empty() {
            fallback_path.to_string()
        } else {
            comment.path.trim().to_string()
        },
        // The commented version's numbers win: `line` is null for a thread on
        // an outdated diff, and the original numbers are what its diffHunk is
        // drawn against. `line` stays null when both are absent.
        line: comment.line.or(comment.original_line),
        start_line: comment.start_line.or(comment.original_start_line),
        original_line: comment.original_line,
        original_start_line: comment.original_start_line,
        diff_hunk: comment.diff_hunk,
        thread_id: String::new(),
        resolved,
        replies: Vec::new(),
    })
}

fn review_into(review: RawReview) -> Option<wire::PullComment> {
    let state = review.state.trim().to_uppercase();
    if state.is_empty() || state == "PENDING" {
        return None;
    }
    let submitted_at = review.submitted_at.as_deref().unwrap_or_default().trim();
    // A COMMENTED review with no body is GitHub's "reviewed" placeholder —
    // nothing to read, nothing to render.
    if submitted_at.is_empty() || (state == "COMMENTED" && review.body.trim().is_empty()) {
        return None;
    }
    let author_login = review.author.unwrap_or_default().login.trim().to_string();
    let id = if review.id.trim().is_empty() {
        format!("review:{}:{submitted_at}", author_login)
    } else {
        review.id.trim().to_string()
    };
    Some(wire::PullComment {
        id,
        kind: "review".into(),
        author: (!author_login.is_empty()).then(|| wire::PullActor {
            login: author_login.clone(),
            avatar_url: actor_avatar(&author_login),
        }),
        body: review.body,
        created_at: submitted_at.to_string(),
        url: review.url,
        state,
        path: String::new(),
        line: None,
        start_line: None,
        original_line: None,
        original_start_line: None,
        diff_hunk: String::new(),
        thread_id: String::new(),
        resolved: false,
        replies: Vec::new(),
    })
}

pub(super) fn parse_pr_thread(pr: &serde_json::Value) -> Result<wire::PullThread> {
    let raw: RawThread =
        serde_json::from_value(pr.clone()).context("parsing pull request thread")?;
    let mut comments: Vec<wire::PullComment> = Vec::new();
    let mut truncated = (raw.comments.nodes.len() as u64) < raw.comments.total_count
        || (raw.reviews.nodes.len() as u64) < raw.reviews.total_count
        || (raw.review_threads.nodes.len() as u64) < raw.review_threads.total_count;

    comments.extend(
        raw.comments
            .nodes
            .into_iter()
            .filter_map(|comment| thread_comment_into(comment, "comment", "", false)),
    );
    comments.extend(raw.reviews.nodes.into_iter().filter_map(review_into));
    for thread in raw.review_threads.nodes {
        let thread_id = thread.id.trim().to_string();
        if thread_id.is_empty() {
            continue;
        }
        truncated |= (thread.comments.nodes.len() as u64) < thread.comments.total_count;
        let mut mapped = thread.comments.nodes.into_iter().filter_map(|comment| {
            thread_comment_into(comment, "review_comment", &thread.path, thread.is_resolved)
        });
        let Some(mut first) = mapped.next() else {
            continue;
        };
        first.thread_id = thread_id.clone();
        first.replies = mapped
            .map(|mut reply| {
                reply.thread_id = thread_id.clone();
                reply
            })
            .collect();
        comments.push(first);
    }
    comments.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(wire::PullThread {
        comments,
        truncated,
        review_decision: raw.review_decision,
        base_ref_name: raw.base_ref_name,
        head_ref_name: raw.head_ref_name,
    })
}
