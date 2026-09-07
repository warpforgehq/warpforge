//! The GraphQL calls: the issue listing with its board column, and the pull
//! request conversation.

#![allow(deprecated)]

use anyhow::{anyhow, bail, Context, Result};

use super::cli::{gh, github_owner_repo};
use super::{github_token, GITHUB_GRAPHQL};
use crate::daemon::tracker::NETWORK_TIMEOUT;

pub(super) async fn github_graphql(
    token: &str,
    query: &str,
    vars: serde_json::Value,
) -> Result<serde_json::Value> {
    let client = reqwest::Client::new();
    let resp = client
        .post(GITHUB_GRAPHQL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "warpforge")
        .timeout(NETWORK_TIMEOUT)
        .json(&serde_json::json!({"query":query,"variables":vars}))
        .send()
        .await
        .context("GitHub GraphQL request")?;
    let text = resp
        .text()
        .await
        .context("reading GitHub GraphQL response")?;
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parsing GitHub GraphQL response")?;
    if let Some(errs) = v.get("errors") {
        bail!("GitHub GraphQL error: {errs}");
    }
    Ok(v)
}

/// Run a query with the PAT when there is one, and through `gh api graphql`
/// when there is not. Both paths return the same envelope, so callers read one
/// shape.
pub(super) async fn github_query(
    repo_dir: &str,
    query: &str,
    vars: serde_json::Value,
) -> Result<serde_json::Value> {
    if let Some(tok) = github_token() {
        return github_graphql(&tok, query, vars).await;
    }
    let mut args: Vec<String> = vec![
        "api".into(),
        "graphql".into(),
        "-f".into(),
        format!("query={query}"),
    ];
    // `-F` types the value the way GraphQL needs it, so a number stays a number;
    // `-f` would send every variable as a string and fail an `Int!`.
    for (key, value) in vars.as_object().into_iter().flatten() {
        let literal = match value {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        args.push("-F".into());
        args.push(format!("{key}={literal}"));
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = gh(Some(repo_dir), &args).await?;
    if !out.status.success() {
        bail!(
            "GitHub GraphQL query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    serde_json::from_slice(&out.stdout).context("parsing GitHub GraphQL response")
}

/// The issue listing query. `state` is `open` for import (a closed issue is not
/// backlog) and anything else for sync (an item on the board may since have
/// been closed).
///
/// The state filter is interpolated rather than passed as a variable: `gh`
/// sends every `-f` as a string and the field takes a list of enums. Both
/// values are ours, not a caller's, so there is nothing to inject.
pub(super) fn project_issues_query(state: &str) -> String {
    let states = if state.eq_ignore_ascii_case("open") {
        "[OPEN]"
    } else {
        "[OPEN, CLOSED]"
    };
    format!(
        "query($owner: String!, $repo: String!, $first: Int!) {{ \
           repository(owner: $owner, name: $repo) {{ \
             issues(first: $first, states: {states}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ \
               nodes {{ number title body url state stateReason createdAt updatedAt \
                 assignees(first: 1) {{ nodes {{ login }} }} \
                 projectItems(first: 5, includeArchived: false) {{ nodes {{ \
                   fieldValueByName(name: \"Status\") {{ \
                     ... on ProjectV2ItemFieldSingleSelectValue {{ name }} }} }} }} }} }} }} }}"
    )
}

/// A pull request conversation in one round trip: the issue-style comments, the
/// submitted reviews, and the inline review threads with their replies. Asking
/// for the three separately costs three requests and can stitch together states
/// that never coexisted, so the whole thread is one query.
const PR_THREAD_QUERY: &str = r#"
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      baseRefName
      headRefName
      comments(last: 40) {
        totalCount
        nodes { id author { login } body createdAt url isMinimized }
      }
      reviews(last: 40) {
        totalCount
        nodes { id author { login } body state submittedAt url }
      }
      reviewThreads(last: 20) {
        totalCount
        nodes {
          id
          isResolved
          path
          comments(first: 8) {
            totalCount
            nodes { id author { login } body createdAt url path line originalLine isMinimized }
          }
        }
      }
    }
  }
}
"#;

/// The `pullRequest` node of [`PR_THREAD_QUERY`] for one PR.
// The PR inbox is the caller; it lands on top of this.
#[allow(dead_code)]
pub(crate) async fn github_pr_thread(repo_dir: &str, number: u64) -> Result<serde_json::Value> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let payload = github_query(
        repo_dir,
        PR_THREAD_QUERY,
        serde_json::json!({"owner": owner, "repo": repo, "number": number}),
    )
    .await?;
    payload
        .pointer("/data/repository/pullRequest")
        .filter(|node| !node.is_null())
        .cloned()
        .ok_or_else(|| anyhow!("GitHub has no pull request #{number} here"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_issue_query_asks_for_the_status_field_and_scopes_by_state() {
        let import = project_issues_query("open");
        assert!(import.contains("states: [OPEN]"), "{import}");
        assert!(
            project_issues_query("all").contains("states: [OPEN, CLOSED]"),
            "sync must see issues that were closed since"
        );
        assert!(
            import.contains("fieldValueByName(name: \"Status\")"),
            "{import}"
        );
    }

    #[test]
    fn the_pr_thread_is_one_query_for_comments_reviews_and_review_threads() {
        assert_eq!(
            PR_THREAD_QUERY.matches("query").count(),
            1,
            "a second query means a second round trip"
        );
        for field in ["comments(", "reviews(", "reviewThreads("] {
            assert!(PR_THREAD_QUERY.contains(field), "missing {field}");
        }
        assert!(
            PR_THREAD_QUERY.contains("reviewDecision"),
            "the inbox reads the review decision from the same trip"
        );
    }
}
