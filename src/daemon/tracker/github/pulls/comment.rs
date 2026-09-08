//! The writes: post a conversation comment, reply on a review thread, or start
//! a new inline review thread on a diff line.

#![allow(deprecated)]

use anyhow::{anyhow, bail, Context, Result};

use super::super::cli::{body_file, gh, github_owner_repo};
use super::super::graphql::{github_graphql, github_query};
use super::super::{github_token, GITHUB_API};
use crate::daemon::tracker::NETWORK_TIMEOUT;

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
        return post_review_reply(repo_dir, reply, body).await;
    }
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    if let Some(token) = github_token() {
        let client = reqwest::Client::new();
        let resp = client
            .post(format!(
                "{GITHUB_API}/repos/{owner}/{repo}/issues/{number}/comments"
            ))
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "warpforge")
            .timeout(NETWORK_TIMEOUT)
            .json(&serde_json::json!({"body": body}))
            .send()
            .await
            .context("posting comment")?
            .error_for_status()
            .context("posting comment")?;
        let value: serde_json::Value = resp.json().await.context("parsing comment response")?;
        return value
            .get("html_url")
            .and_then(|url| url.as_str())
            .map(str::to_string)
            .ok_or_else(|| anyhow!("GitHub did not return a comment URL"));
    }
    // The body travels in a file: a comment is markdown of any length, and
    // argv is neither long enough nor private.
    let file = body_file(body)?;
    let body_arg = format!("body=@{}", file.path().display());
    let api_path = format!("repos/{owner}/{repo}/issues/{number}/comments");
    let out = gh(
        Some(repo_dir),
        &["api", "-X", "POST", &api_path, "--field", &body_arg],
    )
    .await?;
    if !out.status.success() {
        bail!(
            "comment failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let value: serde_json::Value =
        serde_json::from_slice(&out.stdout).context("parsing comment response")?;
    value
        .get("html_url")
        .and_then(|url| url.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("GitHub did not return a comment URL"))
}

/// A reply rides the GraphQL mutation: the REST API has no thread endpoint,
/// and `gh` has no reply subcommand.
async fn post_review_reply(repo_dir: &str, thread_id: &str, body: &str) -> Result<String> {
    if !valid_thread_id(thread_id) {
        bail!("invalid review thread id");
    }
    let payload = github_query(
        repo_dir,
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
/// `startSide` are left off the input rather than sent as null. That also
/// keeps the `gh` fallback honest, which has no way to spell a JSON null
/// beyond `-F key=null`'s magic-value conversion.
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
    let payload = add_review_thread(repo_dir, &pull_id, &input).await?;
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
    let payload = github_query(
        repo_dir,
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
    // Same opaque node-id shape a thread reply is checked against, and for the
    // same reason: on the `gh` path this value becomes an argv token.
    if !valid_thread_id(id) {
        bail!("could not resolve pull request #{number}");
    }
    Ok(id.to_string())
}

/// The mutation is *not* routed through `github_query`: on the `gh` fallback
/// that helper splices every variable into argv as `-F key=value`, and a
/// comment body must never travel in argv (ADR-0010 invariant 3). So the PAT
/// path sends the body as JSON, and the `gh` path passes `--field body=@<file>`
/// — the same temp-file transport `github_pr_comment` uses for its REST write.
/// Only `body` needs it, but keeping the whole call here avoids widening
/// `github_query` for every other caller.
async fn add_review_thread(
    repo_dir: &str,
    pull_id: &str,
    input: &ReviewCommentInput,
) -> Result<serde_json::Value> {
    if let Some(token) = github_token() {
        let mut vars = serde_json::json!({
            "pullRequestId": pull_id,
            "path": input.path,
            "line": input.line,
            "side": input.side,
            "body": input.body,
        });
        if let (Some(start_line), Some(start_side)) = (input.start_line, input.start_side.as_ref())
        {
            vars["startLine"] = start_line.into();
            vars["startSide"] = start_side.clone().into();
        }
        return github_graphql(&token, ADD_REVIEW_THREAD, vars).await;
    }
    let file = body_file(&input.body)?;
    let query_arg = format!("query={ADD_REVIEW_THREAD}");
    let id_arg = format!("pullRequestId={pull_id}");
    let path_arg = format!("path={}", input.path);
    let side_arg = format!("side={}", input.side);
    // `-f` keeps a value a string verbatim; `-F` types it, which `line` needs to
    // satisfy `Int!` and which is also what reads `body` out of the file.
    let line_arg = format!("line={}", input.line);
    let body_arg = format!("body=@{}", file.path().display());
    let start_line_arg = input.start_line.map(|start| format!("startLine={start}"));
    let start_side_arg = input
        .start_side
        .as_ref()
        .map(|start_side| format!("startSide={start_side}"));
    let mut args: Vec<&str> = vec![
        "api", "graphql", "-f", &query_arg, "-f", &id_arg, "-f", &path_arg, "-f", &side_arg, "-F",
        &line_arg,
    ];
    if let Some(arg) = &start_line_arg {
        args.extend(["-F", arg]);
    }
    if let Some(arg) = &start_side_arg {
        args.extend(["-f", arg]);
    }
    // The body goes last and only its *path* is an argument: the bytes stay in
    // the temp file (ADR-0010 invariant 8).
    args.extend(["-F", &body_arg]);
    let out = gh(Some(repo_dir), &args).await?;
    if !out.status.success() {
        bail!(
            "review comment failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let payload: serde_json::Value =
        serde_json::from_slice(&out.stdout).context("parsing GitHub GraphQL response")?;
    if let Some(errors) = payload.get("errors") {
        bail!("GitHub GraphQL error: {errors}");
    }
    Ok(payload)
}
