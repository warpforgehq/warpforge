//! Reading and writing GitHub issues: the board-aware listing, the search
//! pager, and issue creation.

use anyhow::{anyhow, Result};
use reqwest::Method;
use std::sync::Mutex;

use super::auth::github_token;
use super::graphql::project_issues_query;
use super::http::{error_messages, graphql_partial, rest_get_query, rest_json, Partial};
use super::repo::github_owner_repo;
use crate::daemon::tracker::{normalize_status, rfc3339_secs, RemoteIssue, IMPORT_LIMIT};

/// The normalized status of a GitHub issue.
///
/// A closed issue is finished work whatever a board says, so its state decides;
/// `NOT_PLANNED` is the closest thing GitHub has to "cancelled". An open issue
/// takes the status from its Projects V2 board column, which is where GitHub
/// users actually track progress — an unrecognized column name leaves it as
/// untouched work rather than guessing.
fn github_status(state: &str, state_reason: Option<&str>, board_column: Option<&str>) -> String {
    if state.eq_ignore_ascii_case("closed") {
        return if state_reason.is_some_and(|reason| reason.eq_ignore_ascii_case("not_planned")) {
            "cancelled"
        } else {
            "done"
        }
        .to_string();
    }
    board_column
        .and_then(normalize_status)
        .unwrap_or("todo")
        .to_string()
}

fn is_missing_scope_error(msg: &str) -> bool {
    msg.contains("read:project") || msg.contains("requires one of the following scopes")
}

fn missing_scope_warning() -> String {
    "GitHub board statuses unavailable — your token lacks the 'read:project' scope. Add it at https://github.com/settings/tokens, or run `gh auth refresh -s read:project`. Showing open/closed instead.".to_string()
}

fn board_fallback_warning(original_error: &str) -> String {
    if is_missing_scope_error(original_error) {
        missing_scope_warning()
    } else {
        format!("GitHub board statuses unavailable ({original_error}); using open/closed")
    }
}

/// An error about the board half of a query: a missing scope, or a project
/// the token may not read. The issues beside it are still good.
fn is_board_error(error: &serde_json::Value) -> bool {
    let on_board_path = error
        .get("path")
        .and_then(|path| path.as_array())
        .is_some_and(|path| {
            path.iter()
                .any(|step| step.as_str() == Some("projectItems"))
        });
    let message = error.get("message").and_then(|m| m.as_str()).unwrap_or("");
    on_board_path
        || error.get("type").and_then(|t| t.as_str()) == Some("INSUFFICIENT_SCOPES")
        || is_missing_scope_error(message)
}

/// The token last seen refusing `projectItems` outright. Asking it again would
/// only cost a failed round trip before the board-less one.
static NO_BOARD_TOKEN: Mutex<Option<String>> = Mutex::new(None);

fn log_board_warning(warning: String) -> String {
    eprintln!("[tracker] {warning}");
    warning
}

/// Run an issue query with the board column when the token can read boards,
/// without it when it cannot. Board errors become the returned warning, other
/// errors beside data are logged, and the data is kept.
pub(super) async fn board_aware_query(
    query: impl Fn(bool) -> String,
    vars: serde_json::Value,
) -> Result<(Partial, Option<String>)> {
    let token = github_token().await;
    let known_boardless = token.is_some()
        && NO_BOARD_TOKEN
            .lock()
            .ok()
            .is_some_and(|guard| *guard == token);
    let warning = if known_boardless {
        Some(log_board_warning(missing_scope_warning()))
    } else {
        match graphql_partial(&query(true), vars.clone()).await {
            Ok(partial) => {
                let (board, other): (Vec<_>, Vec<_>) =
                    partial.errors.iter().cloned().partition(is_board_error);
                let warning = (!board.is_empty())
                    .then(|| log_board_warning(board_fallback_warning(&error_messages(&board))));
                if !other.is_empty() {
                    eprintln!(
                        "[tracker] GitHub partial answer: {}",
                        error_messages(&other)
                    );
                }
                return Ok((partial, warning));
            }
            Err(e) => {
                if !is_missing_scope_error(&format!("{e:#}")) {
                    return Err(e);
                }
                if let Ok(mut guard) = NO_BOARD_TOKEN.lock() {
                    *guard = token;
                }
                Some(log_board_warning(missing_scope_warning()))
            }
        }
    };
    Ok((graphql_partial(&query(false), vars).await?, warning))
}

/// Recently updated issues, open and closed, with their board column. Teams
/// track status in a Projects V2 "Status" field, which only GraphQL exposes;
/// without `read:project` the status falls back to open/closed, with a warning.
pub(crate) async fn github_list_issues(
    repo_dir: &str,
) -> Result<(Vec<RemoteIssue>, Option<String>)> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let started = std::time::Instant::now();
    let (partial, warning) = board_aware_query(
        project_issues_query,
        serde_json::json!({"owner": owner, "repo": repo, "first": IMPORT_LIMIT}),
    )
    .await?;
    let repository = partial
        .data
        .get("repository")
        .filter(|node| !node.is_null())
        .ok_or_else(|| anyhow!("GitHub has no repository {owner}/{repo} this account can read"))?;
    let issues: Vec<RemoteIssue> = ["open", "closed"]
        .iter()
        .filter_map(|alias| repository.pointer(&format!("/{alias}/nodes"))?.as_array())
        .flatten()
        .filter_map(parse_issue)
        .collect();
    eprintln!(
        "[tracker] github listing {owner}/{repo}: {} issues in {} ms",
        issues.len(),
        started.elapsed().as_millis()
    );
    Ok((issues, warning))
}

pub(super) fn parse_issue(issue: &serde_json::Value) -> Option<RemoteIssue> {
    let number = issue.get("number")?.as_u64()?;
    let text = |key: &str| {
        issue
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let state = issue
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("OPEN");
    let column = board_column(issue);
    Some(RemoteIssue {
        external_id: format!("#{number}"),
        title: text("title"),
        body: text("body"),
        url: text("url"),
        status: github_status(
            state,
            issue.get("stateReason").and_then(|v| v.as_str()),
            column.as_deref(),
        ),
        // The board column is what the team sees on GitHub, so that is the
        // label to show; without one there is only open/closed.
        remote_status: column.unwrap_or_else(|| state.to_string()),
        assignee: assignee_login(issue.get("assignees").and_then(|a| a.get("nodes")), None),
        created_at: rfc3339_secs(&text("createdAt")),
        updated_at: rfc3339_secs(&text("updatedAt")),
        closed: state.eq_ignore_ascii_case("closed"),
    })
}

/// The issue's Projects V2 "Status" column. An issue can sit on several boards;
/// the first one that has a Status value answers, because a project without
/// that field says nothing about the work.
fn board_column(issue: &serde_json::Value) -> Option<String> {
    issue
        .pointer("/projectItems/nodes")?
        .as_array()?
        .iter()
        .find_map(|item| {
            item.pointer("/fieldValueByName/name")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
}

/// First assignee login from a GitHub item. Prefers the plural `assignees`
/// array (what GraphQL and the Search API emit);
/// falls back to the deprecated singular `assignee` object.
fn assignee_login(
    assignees: Option<&serde_json::Value>,
    assignee: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(array) = assignees.and_then(|v| v.as_array()) {
        if let Some(first) = array.first() {
            if let Some(login) = first.get("login").and_then(|v| v.as_str()) {
                return Some(login.to_string());
            }
        }
    }
    assignee
        .and_then(|a| a.get("login"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Fetch one GitHub Search API page. It asks GitHub for exactly one page and
/// gives us `total_count` for the pager.
pub(crate) async fn github_search_issues_page(
    repo_dir: &str,
    page: u32,
    page_size: u32,
    sort_by: &str,
    sort_desc: bool,
    search: &str,
    status: Option<&str>,
) -> Result<(Vec<RemoteIssue>, Option<u64>)> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let state = match status {
        Some("done") | Some("cancelled") => "closed",
        Some("todo") => "open",
        _ => "all",
    };
    let mut query = format!("repo:{owner}/{repo} is:issue");
    if state != "all" {
        query.push_str(&format!(" state:{state}"));
    }
    if !search.trim().is_empty() {
        query.push(' ');
        query.push_str(search.trim());
    }
    let sort = if matches!(sort_by, "title" | "number") {
        "created"
    } else {
        "updated"
    };
    let payload = rest_get_query(
        "search/issues",
        &[
            ("q", query),
            ("page", page.saturating_add(1).to_string()),
            ("per_page", page_size.min(100).to_string()),
            ("sort", sort.to_string()),
            ("order", if sort_desc { "desc" } else { "asc" }.to_string()),
        ],
    )
    .await?;
    let total = payload.get("total_count").and_then(|v| v.as_u64());
    let parsed = payload
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let issues = parsed
        .into_iter()
        .filter_map(|issue| {
            let number = issue.get("number")?.as_u64()?;
            let native_state = issue
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("open");
            Some(RemoteIssue {
                external_id: format!("#{number}"),
                title: issue
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .into(),
                body: issue
                    .get("body")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .into(),
                url: issue
                    .get("html_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .into(),
                status: github_status(
                    native_state,
                    issue.get("state_reason").and_then(|v| v.as_str()),
                    None,
                ),
                remote_status: native_state.into(),
                assignee: assignee_login(issue.get("assignees"), issue.get("assignee")),
                created_at: issue
                    .get("created_at")
                    .and_then(|v| v.as_str())
                    .map(rfc3339_secs)
                    .unwrap_or_default(),
                updated_at: issue
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .map(rfc3339_secs)
                    .unwrap_or_default(),
                closed: native_state.eq_ignore_ascii_case("closed"),
            })
        })
        .collect();
    Ok((issues, total))
}

/// Create a GitHub issue in the repo at `repo_dir`. Returns (issue number,
/// html URL).
pub async fn github_create_issue(
    repo_dir: &str,
    title: &str,
    body: &str,
) -> Result<(String, String)> {
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let mut payload = serde_json::json!({ "title": title });
    if !body.trim().is_empty() {
        payload["body"] = body.trim().into();
    }
    let parsed = rest_json(
        Method::POST,
        &format!("repos/{owner}/{repo}/issues"),
        Some(&payload),
    )
    .await?;
    let number = parsed
        .get("number")
        .and_then(|n| n.as_u64())
        .ok_or_else(|| anyhow!("GitHub issue response had no number"))?;
    let url = parsed
        .get("html_url")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    Ok((format!("#{number}"), url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_issue_is_finished_whatever_the_board_says() {
        assert_eq!(github_status("CLOSED", None, Some("In Progress")), "done");
        assert_eq!(github_status("CLOSED", Some("COMPLETED"), None), "done");
        assert_eq!(
            github_status("CLOSED", Some("NOT_PLANNED"), None),
            "cancelled"
        );
    }

    #[test]
    fn an_open_issue_takes_its_status_from_the_board() {
        assert_eq!(
            github_status("OPEN", None, Some("In Progress")),
            "in_progress"
        );
        assert_eq!(github_status("OPEN", None, Some("Done")), "done");
        // No board, or a column this vocabulary cannot place, reads as
        // untouched work rather than a guess.
        assert_eq!(github_status("OPEN", None, None), "todo");
        assert_eq!(github_status("OPEN", None, Some("Icebox")), "todo");
    }

    #[test]
    fn only_board_errors_are_read_as_a_missing_board() {
        let scope = serde_json::json!({
            "type": "INSUFFICIENT_SCOPES",
            "message": "Your token has not been granted the required scopes"
        });
        let forbidden_board = serde_json::json!({
            "type": "FORBIDDEN",
            "path": ["repository", "open", "nodes", 0, "projectItems"],
            "message": "Resource not accessible by personal access token"
        });
        let other = serde_json::json!({
            "type": "FORBIDDEN",
            "path": ["repository"],
            "message": "x"
        });
        assert!(is_board_error(&scope));
        assert!(is_board_error(&forbidden_board));
        assert!(!is_board_error(&other));
    }

    #[test]
    fn a_closed_issue_node_is_marked_closed_and_keeps_its_column() {
        let issue = parse_issue(&serde_json::json!({
            "number": 7, "title": "t", "url": "u", "state": "CLOSED",
            "stateReason": "NOT_PLANNED", "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-02T00:00:00Z",
            "assignees": { "nodes": [{ "login": "octocat" }] },
            "projectItems": null,
        }))
        .unwrap();
        assert_eq!(issue.external_id, "#7");
        assert!(issue.closed);
        assert_eq!(issue.status, "cancelled");
        assert_eq!(issue.assignee.as_deref(), Some("octocat"));
        assert!(issue.body.is_empty());
    }

    #[test]
    fn the_board_column_is_the_first_project_that_has_a_status_field() {
        let issue = serde_json::json!({
            "projectItems": { "nodes": [
                { "fieldValueByName": null },
                { "fieldValueByName": { "name": "In Test" } },
            ]}
        });
        assert_eq!(board_column(&issue).as_deref(), Some("In Test"));
        assert_eq!(board_column(&serde_json::json!({})), None);
    }
}
