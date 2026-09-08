//! Wire types for the GitHub pull-request inbox.
//!
//! `Method` variants live in `lib.rs` (that enum must stay exhaustive in one
//! file); everything the PR reads and writes carry lives here. All types
//! mirror one-for-one what the desktop's `protocol.ts` declares.

use serde::{Deserialize, Serialize};

/// One person on a pull request, as the UI renders them (login + avatar).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullActor {
    pub login: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

/// One label with its GitHub-assigned colour, so the row chip can match what
/// github.com shows. The colour is a bare `RRGGBB` hex string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullLabel {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

/// One pull request in the inbox listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    /// Local warpforge project the PR belongs to (filled by the daemon, not
    /// GitHub — one repo can be checked out under several project names).
    pub project: String,
    /// `owner/name`, as GitHub spells it.
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `open` or `closed`. Merged PRs read `closed` with `merged_at` set;
    /// the inbox v1 lists open work, so the distinction is not rendered.
    pub state: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub author: Option<PullActor>,
    #[serde(default)]
    pub labels: Vec<PullLabel>,
    #[serde(default)]
    pub assignees: Vec<String>,
    pub base_ref_name: String,
    pub head_ref_name: String,
    /// `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED`, or `None` when no
    /// review has been requested yet.
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    /// Diff size, as the list rail renders it (`+312/−89`). It rides the
    /// listing rather than costing a `pulls.details` fetch per row; a source
    /// that cannot supply it leaves it at zero.
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
    #[serde(default)]
    pub changed_files: u64,
}

/// The body-level fields of one pull request, for the detail pane.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetails {
    pub title: String,
    pub url: String,
    pub state: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub author: Option<PullActor>,
    pub base_ref_name: String,
    pub head_ref_name: String,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
    #[serde(default)]
    pub changed_files: u64,
}

/// One file inside a pull request's changes, with its line counts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFile {
    pub path: String,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
}

/// The changes of one pull request: file stats plus the raw unified patch.
///
/// The patch is capped; `truncated` says the daemon dropped the tail rather
/// than the client rendering a partial hunk as if it were whole.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDiff {
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
    #[serde(default)]
    pub files: Vec<PullRequestFile>,
    #[serde(default)]
    pub patch: String,
    #[serde(default)]
    pub truncated: bool,
}

/// One commit on a pull request, as the diff's commit picker lists them.
///
/// `parent_oid` is what makes a range selectable client-side: the patch for
/// commits `i..=j` is the comparison from `commits[i].parent_oid` to
/// `commits[j].oid`, so the client can name a range without a round trip to
/// ask what came before it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullCommit {
    pub oid: String,
    /// The short hash GitHub itself displays (7+ chars, unambiguous in repo).
    #[serde(default)]
    pub abbreviated_oid: String,
    /// First parent. Empty for a root commit, which cannot be a range base.
    #[serde(default)]
    pub parent_oid: String,
    #[serde(default)]
    pub message_headline: String,
    /// RFC-3339 as GitHub emitted it; the client renders it relatively.
    #[serde(default)]
    pub committed_date: String,
    #[serde(default)]
    pub author: Option<PullActor>,
}

/// One comment-shaped node of a pull request conversation. Issue comments,
/// review bodies and inline review comments all render through this shape;
/// `kind` says which, and review threads carry their replies nested.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullComment {
    pub id: String,
    /// `comment` (issue comment), `review` (review body), or
    /// `review_comment` (inline on a diff line).
    pub kind: String,
    #[serde(default)]
    pub author: Option<PullActor>,
    #[serde(default)]
    pub body: String,
    /// RFC-3339 as GitHub emitted it; the client renders it relatively.
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub url: String,
    /// For reviews: `APPROVED` | `CHANGES_REQUESTED` | `COMMENTED` | `DISMISSED`.
    #[serde(default)]
    pub state: String,
    /// For inline comments: the file the comment sits on.
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub line: Option<u64>,
    /// First line of the range a comment covers, when GitHub anchored it to a
    /// multi-line span (`line` is the last line).
    #[serde(default)]
    pub start_line: Option<u64>,
    /// The same fields as of the version the comment was written against —
    /// what `line`/`start_line` fall back to once the diff has moved on.
    #[serde(default)]
    pub original_line: Option<u64>,
    #[serde(default)]
    pub original_start_line: Option<u64>,
    /// The hunk as it stood when the comment was written. The authoritative
    /// quote source: a comment on an outdated diff must quote its own version,
    /// not whichever lines now wear the same numbers.
    #[serde(default)]
    pub diff_hunk: String,
    /// GraphQL node id of the review thread this comment belongs to — what a
    /// reply is addressed to. Empty for issue comments and review bodies.
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub replies: Vec<PullComment>,
}

/// A pull request conversation in one shape: every comment node sorted by
/// time, plus the review metadata the header renders.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullThread {
    pub comments: Vec<PullComment>,
    /// True when the source query's page limits cut nodes off (40 comments /
    /// 40 reviews / 20 threads), so the client can say "older comments hidden"
    /// instead of implying this is everything.
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub review_decision: Option<String>,
    #[serde(default)]
    pub base_ref_name: String,
    #[serde(default)]
    pub head_ref_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_summary_round_trips_as_camel_case() {
        let json = serde_json::json!({
            "project": "warpforge",
            "repo": "acme/widgets",
            "number": 7,
            "title": "Add widget",
            "url": "https://github.com/acme/widgets/pull/7",
            "state": "open",
            "draft": false,
            "baseRefName": "main",
            "headRefName": "feature",
            "reviewDecision": "APPROVED",
        });
        let summary: PullRequestSummary = serde_json::from_value(json).unwrap();
        assert_eq!(summary.repo, "acme/widgets");
        assert_eq!(summary.review_decision.as_deref(), Some("APPROVED"));
        assert!(summary.labels.is_empty());
        assert_eq!(summary.updated_at, 0);
        // A `gh`-CLI path or a cache written before the diff size shipped
        // omits these; they must read zero rather than fail the whole listing.
        assert_eq!(summary.additions, 0);
        assert_eq!(summary.deletions, 0);
        assert_eq!(summary.changed_files, 0);
    }

    #[test]
    fn a_comment_replies_nest_and_defaults_fill_in() {
        let json = serde_json::json!({
            "id": "c1",
            "kind": "review_comment",
            "author": { "login": "octocat" },
            "threadId": "t1",
            "replies": [{ "id": "c2", "kind": "review_comment" }],
        });
        let comment: PullComment = serde_json::from_value(json).unwrap();
        assert_eq!(comment.author.as_ref().unwrap().login, "octocat");
        assert_eq!(comment.replies[0].id, "c2");
        assert!(comment.replies[0].body.is_empty());
        assert!(!comment.resolved);
    }
}
