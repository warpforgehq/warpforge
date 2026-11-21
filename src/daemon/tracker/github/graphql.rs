//! The GraphQL query texts: the issue listing with its board column, the
//! batched lookup by number, and the pull request conversation.

use std::fmt::Write;

/// The fields every issue read asks for. `body` is left out of the closed
/// half of the listing: a closed issue is never adopted, only re-statused.
fn issue_fields(with_body: bool, with_board: bool) -> String {
    let mut fields = String::from(
        "number title url state stateReason createdAt updatedAt \
         assignees(first: 1) { nodes { login } }",
    );
    if with_body {
        fields.push_str(" body");
    }
    if with_board {
        fields.push_str(
            " projectItems(first: 5, includeArchived: false) { nodes { \
               fieldValueByName(name: \"Status\") { \
                 ... on ProjectV2ItemFieldSingleSelectValue { name } } } }",
        );
    }
    fields
}

/// Open and closed issues in one round trip: open ones feed import, both
/// refresh tracked rows. `with_board` drops `projectItems` for a token without
/// `read:project`, which GitHub would otherwise refuse the whole query for.
pub(super) fn project_issues_query(with_board: bool) -> String {
    let issues = |states: &str, with_body: bool| {
        format!(
            "issues(first: $first, states: {states}, \
               orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ nodes {{ {} }} }}",
            issue_fields(with_body, with_board)
        )
    };
    format!(
        "query($owner: String!, $repo: String!, $first: Int!) {{ \
           repository(owner: $owner, name: $repo) {{ \
             open: {} closed: {} }} }}",
        issues("[OPEN]", true),
        issues("[CLOSED]", false),
    )
}

/// One query for many issues by number, each under its own alias
/// (`i123: issue(number: 123)`). A deleted issue answers `null` with a
/// `NOT_FOUND` error on its alias' path. Numbers are `u64`s, so nothing a
/// caller sends can reach the query text.
pub(super) fn issues_by_number_query(numbers: &[u64], with_board: bool) -> String {
    let fields = issue_fields(false, with_board);
    let mut query = String::from("query($owner: String!, $repo: String!) {");
    query.push_str(" repository(owner: $owner, name: $repo) {");
    for number in numbers {
        let _ = write!(query, " i{number}: issue(number: {number}) {{ {fields} }}");
    }
    query.push_str(" } }");
    query
}

/// A pull request conversation in one round trip: the issue-style comments, the
/// submitted reviews, and the inline review threads with their replies. Asking
/// for the three separately costs three requests and can stitch together states
/// that never coexisted, so the whole thread is one query.
pub(super) const GITHUB_PR_THREAD_QUERY: &str = r#"
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
            nodes { id author { login } body createdAt url path line originalLine startLine originalStartLine diffHunk isMinimized }
          }
        }
      }
    }
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_listing_reads_open_and_closed_in_one_query() {
        let query = project_issues_query(true);
        assert_eq!(query.matches("query(").count(), 1);
        assert!(
            query.contains("open: issues(first: $first, states: [OPEN]"),
            "{query}"
        );
        assert!(
            query.contains("closed: issues(first: $first, states: [CLOSED]"),
            "{query}"
        );
        assert!(
            query.contains("fieldValueByName(name: \"Status\")"),
            "{query}"
        );
        assert_eq!(
            query.matches(" body").count(),
            1,
            "closed issues skip the body"
        );
        assert!(!project_issues_query(false).contains("projectItems"));
    }

    #[test]
    fn the_batched_lookup_aliases_each_issue_by_number() {
        let query = issues_by_number_query(&[12, 345], true);
        assert!(query.contains("i12: issue(number: 12) {"), "{query}");
        assert!(query.contains("i345: issue(number: 345) {"), "{query}");
        assert_eq!(query.matches("query(").count(), 1);
        assert!(query.contains("stateReason"));
        assert!(query.contains("projectItems"));
        assert!(!issues_by_number_query(&[1], false).contains("projectItems"));
    }

    #[test]
    fn the_pr_thread_is_one_query_for_comments_reviews_and_review_threads() {
        assert_eq!(
            GITHUB_PR_THREAD_QUERY.matches("query").count(),
            1,
            "a second query means a second round trip"
        );
        for field in ["comments(", "reviews(", "reviewThreads("] {
            assert!(GITHUB_PR_THREAD_QUERY.contains(field), "missing {field}");
        }
        assert!(
            GITHUB_PR_THREAD_QUERY.contains("reviewDecision"),
            "the inbox reads the review decision from the same trip"
        );
    }
}
