//! The writes: post a conversation comment, reply on a review thread, or start
//! a new inline review thread on a diff line.

use anyhow::{anyhow, bail, Context, Result};
use reqwest::Method;

use super::super::http::{github_graphql, rest_json};
use super::super::repo::github_owner_repo;

/// A review-thread node id is GraphQL's opaque identifier. Only its shape is
/// stable, and only that shape is checked: anything else the API sent is not
/// a thread a reply can be attached to.
pub(super) fn valid_thread_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.len() < 256
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'='))
}

/// Post a conversation comment, or reply on a review thread when
/// `in_reply_to` carries one. Returns the comment's URL.
pub(crate) async fn github_pr_comment(
    repo_dir: &str,
    number: u64,
    body: &str,
    in_reply_to: &str,
) -> Result<String> {
    let body = body.trim();
    if body.is_empty() {
        bail!("comment body is empty");
    }
    let reply = in_reply_to.trim();
    if !reply.is_empty() {
        return post_review_reply(reply, body).await;
    }
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let value = rest_json(
        Method::POST,
        &format!("repos/{owner}/{repo}/issues/{number}/comments"),
        Some(&serde_json::json!({ "body": body })),
    )
    .await
    .context("posting comment")?;
    value
        .get("html_url")
        .and_then(|url| url.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("GitHub did not return a comment URL"))
}

/// A reply rides the GraphQL mutation: the REST API has no thread endpoint.
async fn post_review_reply(thread_id: &str, body: &str) -> Result<String> {
    if !valid_thread_id(thread_id) {
        bail!("invalid review thread id");
    }
    let payload = github_graphql(
        "mutation($threadId: ID!, $body: String!) { \
           addPullRequestReviewThreadReply(input: \
             { pullRequestReviewThreadId: $threadId, body: $body }) { \
             comment { url } } }",
        serde_json::json!({"threadId": thread_id.trim(), "body": body}),
    )
    .await?;
    let url = payload
        .pointer("/data/addPullRequestReviewThreadReply/comment/url")
        .and_then(|url| url.as_str())
        .unwrap_or_default()
        .trim();
    if url.is_empty() {
        bail!("GitHub did not return a comment URL");
    }
    Ok(url.to_string())
}

/// What the review-thread mutation needs, once the caller's arguments have
/// been checked. Kept apart from the call so the rules are testable without a
/// network.
pub(super) struct ReviewCommentInput {
    pub path: String,
    pub line: u64,
    pub side: String,
    pub body: String,
    /// `Some` only when a real multi-line range survived normalisation, and
    /// then both fields are `Some` together: the thread spans
    /// `start_line..=line`.
    pub start_line: Option<u64>,
    pub start_side: Option<String>,
}

/// `side` names which image of the diff the line belongs to: `RIGHT` is the
/// post-image (added or unchanged), `LEFT` a line the diff deleted. GitHub's
/// `DiffSide` enum has no third value, so anything else is a client bug worth
/// a message rather than a GraphQL error.
///
/// `start_line`/`start_side` turn the comment into a range: GitHub anchors the
/// thread from the start down to `line`, so the start must not run past the
/// end. A start that lands on the same line and side as the end is not a range
/// at all and is dropped, because GitHub rejects a one-line "range".
pub(super) fn review_comment_input(
    path: &str,
    line: u64,
    side: &str,
    body: &str,
    start_line: Option<u64>,
    start_side: Option<&str>,
) -> Result<ReviewCommentInput> {
    let body = body.trim();
    if body.is_empty() {
        bail!("comment body is empty");
    }
    let path = path.trim();
    if path.is_empty() {
        bail!("review comment needs a file path");
    }
    if line == 0 {
        bail!("review comment needs a diff line (lines are 1-based)");
    }
    let side = side.trim().to_ascii_uppercase();
    if side != "LEFT" && side != "RIGHT" {
        bail!("review comment side must be LEFT or RIGHT, got {side:?}");
    }
    // A given start side is checked even when no start line came with it: it is
    // a client bug either way, and silently dropping a bad value hides it.
    let start_side = match start_side {
        Some(raw) => {
            let normalised = raw.trim().to_ascii_uppercase();
            if normalised != "LEFT" && normalised != "RIGHT" {
                bail!("review comment start side must be LEFT or RIGHT, got {normalised:?}");
            }
            normalised
        }
        None => side.clone(),
    };
    let mut start_line = start_line;
    if let Some(start) = start_line {
        if start == 0 {
            bail!("review comment start line must be 1 or more (lines are 1-based)");
        }
        if start > line {
            bail!("review comment start line {start} is past its end line {line}");
        }
        if start == line && start_side == side {
            // One line on one side is a single-line comment, and GitHub errors
            // on a range that does not span anything.
            start_line = None;
        }
    }
    Ok(ReviewCommentInput {
        path: path.to_string(),
        line,
        side,
        body: body.to_string(),
        start_side: start_line.map(|_| start_side),
        start_line,
    })
}

/// The mutation that opens a thread. `line`/`side` ride as typed variables so
/// neither the path nor the enum is spliced into the query text.
///
/// The range variables are declared nullable so one query text serves both
/// shapes — a second query string would be the same mutation twice, and drift.
/// A single-line comment simply does not supply them: GraphQL treats a
/// nullable variable that was not provided as absent, so `startLine`/
/// `startSide` are left off the input rather than sent as null.
const ADD_REVIEW_THREAD: &str = "mutation($pullRequestId: ID!, $path: String!, \
   $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide, $body: String!) { \
     addPullRequestReviewThread(input: \
       { pullRequestId: $pullRequestId, path: $path, line: $line, side: $side, \
         startLine: $startLine, startSide: $startSide, body: $body }) { \
       thread { comments(first: 1) { nodes { url } } } } }";

/// Start a new inline review thread on one line — or one range of lines — of a
/// pull request's diff. Returns the created comment's URL.
// The arguments are the wire request's fields, one for one; bundling them into
// a struct here would only move the dispatch arm's destructuring around.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn github_pr_review_comment(
    repo_dir: &str,
    number: u64,
    path: &str,
    line: u64,
    side: &str,
    body: &str,
    start_line: Option<u64>,
    start_side: Option<&str>,
) -> Result<String> {
    let input = review_comment_input(path, line, side, body, start_line, start_side)?;
    let pull_id = pull_request_node_id(repo_dir, number).await?;
    let payload = add_review_thread(&pull_id, &input).await?;
    let url = payload
        .pointer("/data/addPullRequestReviewThread/thread/comments/nodes/0/url")
        .and_then(|url| url.as_str())
        .unwrap_or_default()
        .trim();
    if url.is_empty() {
        bail!("GitHub did not return a comment URL");
    }
    Ok(url.to_string())
}

/// The pull request's GraphQL node id, which the thread mutation addresses.
/// It is resolved here rather than carried on the read wire types: a node id
/// is a write-path concern, and the listing should not have to ship one to
/// every client to make this call possible.
async fn pull_request_node_id(repo_dir: &str, number: u64) -> Result<String> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_graphql(
        "query($owner: String!, $repo: String!, $number: Int!) { \
           repository(owner: $owner, name: $repo) { \
             pullRequest(number: $number) { id } } }",
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    let id = payload
        .pointer("/data/repository/pullRequest/id")
        .and_then(|id| id.as_str())
        .unwrap_or_default()
        .trim();
    // Same opaque node-id shape a thread reply is checked against.
    if !valid_thread_id(id) {
        bail!("could not resolve pull request #{number}");
    }
    Ok(id.to_string())
}

async fn add_review_thread(pull_id: &str, input: &ReviewCommentInput) -> Result<serde_json::Value> {
    let mut vars = serde_json::json!({
        "pullRequestId": pull_id,
        "path": input.path,
        "line": input.line,
        "side": input.side,
        "body": input.body,
    });
    if let (Some(start_line), Some(start_side)) = (input.start_line, input.start_side.as_ref()) {
        vars["startLine"] = start_line.into();
        vars["startSide"] = start_side.clone().into();
    }
    github_graphql(ADD_REVIEW_THREAD, vars).await
}
