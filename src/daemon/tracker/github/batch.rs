//! Tracked issues the listing did not cover, resolved in batched lookups
//! instead of one request per issue.

use anyhow::Result;
use std::collections::HashMap;

use super::graphql::issues_by_number_query;
use super::issues::{board_aware_query, parse_issue};
use super::repo::github_owner_repo;

/// Issues per lookup. GitHub limits a query's node count, and each alias
/// carries its board items.
const CHUNK: usize = 50;

/// What GitHub says about one tracked issue.
#[derive(Debug, PartialEq)]
pub enum IssueState {
    /// Still there: its normalized status and the label to show.
    Found {
        status: String,
        remote_status: String,
    },
    /// Gone: GitHub answered `NOT_FOUND` for its number.
    Deleted,
}

/// Look up `external_ids` (`#123`) in the repo at `repo_dir`. An id missing
/// from the result is one GitHub said nothing certain about — it is neither
/// refreshed nor deleted.
pub async fn github_issue_states(
    repo_dir: &str,
    external_ids: &[String],
) -> Result<HashMap<String, IssueState>> {
    let numbers: Vec<u64> = external_ids
        .iter()
        .filter_map(|id| id.trim_start_matches('#').parse().ok())
        .collect();
    let mut out = HashMap::new();
    if numbers.is_empty() {
        return Ok(out);
    }
    let (owner, repo) = github_owner_repo(repo_dir).await?;
    let started = std::time::Instant::now();
    for chunk in numbers.chunks(CHUNK) {
        let (partial, _) = board_aware_query(
            |with_board| issues_by_number_query(chunk, with_board),
            serde_json::json!({"owner": owner, "repo": repo}),
        )
        .await?;
        out.extend(read_states(chunk, &partial.data, &partial.errors));
    }
    eprintln!(
        "[tracker] github lookup {owner}/{repo}: {} issues in {} ms",
        numbers.len(),
        started.elapsed().as_millis()
    );
    Ok(out)
}

/// Read each alias. A `null` alias is deleted only when GitHub also reported
/// `NOT_FOUND` on that alias: a `null` for any other reason (a permission
/// error, a timeout inside GitHub) must not delete a backlog row.
pub(super) fn read_states(
    numbers: &[u64],
    data: &serde_json::Value,
    errors: &[serde_json::Value],
) -> HashMap<String, IssueState> {
    let mut out = HashMap::new();
    let Some(repository) = data.get("repository").filter(|r| !r.is_null()) else {
        return out;
    };
    for number in numbers {
        let alias = format!("i{number}");
        let id = format!("#{number}");
        match repository.get(&alias) {
            Some(node) if !node.is_null() => {
                if let Some(issue) = parse_issue(node) {
                    out.insert(
                        id,
                        IssueState::Found {
                            status: issue.status,
                            remote_status: issue.remote_status,
                        },
                    );
                }
            }
            _ if not_found_at(errors, &alias) => {
                out.insert(id, IssueState::Deleted);
            }
            _ => {}
        }
    }
    out
}

fn not_found_at(errors: &[serde_json::Value], alias: &str) -> bool {
    errors.iter().any(|error| {
        error.get("type").and_then(|t| t.as_str()) == Some("NOT_FOUND")
            && error
                .get("path")
                .and_then(|p| p.as_array())
                .is_some_and(|path| path.last().and_then(|s| s.as_str()) == Some(alias))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn found_issues_are_restatused_and_only_not_found_ones_are_deleted() {
        let data = serde_json::json!({ "repository": {
            "i1": { "number": 1, "state": "CLOSED", "stateReason": "COMPLETED" },
            "i2": null,
            "i3": null,
        }});
        let errors = vec![
            serde_json::json!({ "type": "NOT_FOUND", "path": ["repository", "i2"] }),
            serde_json::json!({ "type": "FORBIDDEN", "path": ["repository", "i3"] }),
        ];
        let states = read_states(&[1, 2, 3, 4], &data, &errors);
        assert_eq!(
            states.get("#1"),
            Some(&IssueState::Found {
                status: "done".into(),
                remote_status: "CLOSED".into()
            })
        );
        assert_eq!(states.get("#2"), Some(&IssueState::Deleted));
        assert_eq!(
            states.get("#3"),
            None,
            "a forbidden issue is not a deleted one"
        );
        assert_eq!(
            states.get("#4"),
            None,
            "an alias GitHub skipped says nothing"
        );
    }

    #[test]
    fn an_unreadable_repository_deletes_nothing() {
        let errors = vec![serde_json::json!({ "type": "NOT_FOUND", "path": ["repository"] })];
        let states = read_states(&[1], &serde_json::json!({ "repository": null }), &errors);
        assert!(states.is_empty());
    }
}
