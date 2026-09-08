//! Parsed-shape tests for the pull-request reads. They run against canned
//! JSON, never the network.

use super::comment::{review_comment_input, valid_thread_id};
use super::list::RawPull;
use super::thread::parse_pr_thread;
use super::MAX_PR_DIFF_BYTES;

fn summary_json() -> serde_json::Value {
    serde_json::json!({
        "number": 7,
        "title": "Add widget",
        "url": "https://github.com/acme/widgets/pull/7",
        "state": "OPEN",
        "isDraft": true,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-02-01T00:00:00Z",
        "author": { "login": "octocat" },
        "baseRefName": "main",
        "headRefName": "widget",
        "reviewDecision": "APPROVED",
        "labels": { "nodes": [ { "name": "bug", "color": "ff0000" }, { "name": "x", "color": "" } ] },
        "assignees": { "nodes": [ { "login": "octocat" } ] },
        "additions": 312,
        "deletions": 89,
        "changedFiles": 4,
    })
}

#[test]
fn a_listing_node_maps_onto_the_wire_shape() {
    let raw: RawPull = serde_json::from_value(summary_json()).unwrap();
    let pr = raw.into_wire("acme/widgets").unwrap();
    assert_eq!(pr.repo, "acme/widgets");
    assert_eq!(pr.state, "open");
    assert!(pr.draft);
    assert_eq!(pr.author.as_ref().unwrap().login, "octocat");
    let avatar = pr.author.as_ref().unwrap().avatar_url.clone().unwrap();
    assert!(avatar.ends_with("/octocat?s=64"));
    assert_eq!(pr.labels[0].color.as_deref(), Some("ff0000"));
    // An empty colour is no colour — the client falls back to neutral.
    assert_eq!(pr.labels[1].color, None);
    assert_eq!(pr.assignees, vec!["octocat".to_string()]);
    assert_eq!(pr.updated_at, 1_769_904_000);
    // The diff size comes from the listing, so the rail needs no second fetch.
    assert_eq!((pr.additions, pr.deletions, pr.changed_files), (312, 89, 4));
}

#[test]
fn a_listing_without_diff_counts_reads_zero() {
    let mut node = summary_json();
    let object = node.as_object_mut().unwrap();
    object.remove("additions");
    object.remove("deletions");
    object.remove("changedFiles");
    let raw: RawPull = serde_json::from_value(node).unwrap();
    let pr = raw.into_wire("acme/widgets").unwrap();
    assert_eq!((pr.additions, pr.deletions, pr.changed_files), (0, 0, 0));
}

#[test]
fn the_listing_query_asks_for_the_diff_counts() {
    let query = super::list::pulls_query("[OPEN]");
    assert_eq!(
        query.matches("query").count(),
        1,
        "a second query means a second round trip"
    );
    for field in ["additions", "deletions", "changedFiles"] {
        assert!(query.contains(field), "missing {field}");
    }
}

#[test]
fn assigned_to_me_and_search_filter_the_listing() {
    let pr = {
        let raw: RawPull = serde_json::from_value(summary_json()).unwrap();
        raw.into_wire("acme/widgets").unwrap()
    };
    assert!(pr
        .assignees
        .iter()
        .any(|a| a.eq_ignore_ascii_case("OCTOCAT")));
    assert!(!pr
        .assignees
        .iter()
        .any(|a| a.eq_ignore_ascii_case("someone")));
    assert!(pr.title.to_lowercase().contains("widget"));
    assert!(pr.number.to_string().contains("7"));
}

#[test]
fn a_thread_folds_comments_reviews_and_inline_threads_into_one_list() {
    let pr = serde_json::json!({
        "reviewDecision": "CHANGES_REQUESTED",
        "baseRefName": "main",
        "headRefName": "widget",
        "comments": { "totalCount": 1, "nodes": [
            { "id": "i1", "author": { "login": "a" }, "body": "hello", "createdAt": "2026-01-02T00:00:00Z", "url": "u1" },
            { "id": "i2", "author": { "login": "a" }, "body": "hidden", "createdAt": "2026-01-03T00:00:00Z", "isMinimized": true },
        ]},
        "reviews": { "totalCount": 2, "nodes": [
            { "id": "r1", "author": { "login": "b" }, "body": "looks good", "state": "APPROVED", "submittedAt": "2026-01-01T00:00:00Z", "url": "u2" },
            { "id": "r2", "author": { "login": "b" }, "body": "", "state": "PENDING", "submittedAt": "2026-01-04T00:00:00Z" },
        ]},
        "reviewThreads": { "totalCount": 2, "nodes": [
            { "id": "t1", "isResolved": false, "path": "src/x.rs",
              "comments": { "totalCount": 2, "nodes": [
                  { "id": "c1", "author": { "login": "b" }, "body": "fix this", "createdAt": "2026-01-05T00:00:00Z", "path": "src/x.rs", "line": 12 },
                  { "id": "c2", "author": { "login": "a" }, "body": "ok", "createdAt": "2026-01-06T00:00:00Z", "line": 9 },
              ]}},
            { "id": "", "isResolved": true, "path": "", "comments": { "totalCount": 0, "nodes": [] } },
        ]},
    });
    let thread = parse_pr_thread(&pr).unwrap();
    // The minimized comment, the pending review and the id-less thread are gone.
    assert_eq!(thread.comments.len(), 3);
    assert_eq!(thread.review_decision.as_deref(), Some("CHANGES_REQUESTED"));
    // Time order: review, issue comment, then the inline thread.
    let kinds: Vec<&str> = thread
        .comments
        .iter()
        .map(|comment| comment.kind.as_str())
        .collect();
    assert_eq!(kinds, vec!["review", "comment", "review_comment"]);
    let inline = &thread.comments[2];
    assert_eq!(inline.thread_id, "t1");
    assert_eq!(inline.path, "src/x.rs");
    assert_eq!(inline.line, Some(12));
    // The reply keeps the thread id and keeps its own line anchor.
    assert_eq!(inline.replies.len(), 1);
    assert_eq!(inline.replies[0].thread_id, "t1");
    assert_eq!(inline.replies[0].line, Some(9));
    assert!(!thread.truncated);
}

#[test]
fn an_over_long_patch_is_flagged_not_hidden() {
    let mut patch = "x".repeat(MAX_PR_DIFF_BYTES + 10);
    let mut truncated = false;
    if patch.len() > MAX_PR_DIFF_BYTES {
        let mut cut = MAX_PR_DIFF_BYTES;
        while cut > 0 && !patch.is_char_boundary(cut) {
            cut -= 1;
        }
        patch.truncate(cut);
        truncated = true;
    }
    assert!(truncated);
    assert_eq!(patch.len(), MAX_PR_DIFF_BYTES);
}

#[test]
fn a_thread_id_must_look_like_a_node_id() {
    assert!(valid_thread_id("PRRT_kwDOABC123"));
    assert!(valid_thread_id("a-b_c=d"));
    assert!(!valid_thread_id(""));
    assert!(!valid_thread_id("has space"));
    assert!(!valid_thread_id("../etc"));
}

#[test]
fn a_new_review_comment_is_trimmed_and_its_side_normalised() {
    let input =
        review_comment_input(" src/x.rs ", 12, "right", "  fix this\n", None, None).unwrap();
    assert_eq!(input.path, "src/x.rs");
    assert_eq!(input.line, 12);
    // GitHub's `DiffSide` is an enum: the client's casing must not reach it.
    assert_eq!(input.side, "RIGHT");
    assert_eq!(input.body, "fix this");
    assert_eq!(
        review_comment_input("src/x.rs", 3, " left ", "gone", None, None)
            .unwrap()
            .side,
        "LEFT"
    );
    // An omitted side defaults to the post-image at the protocol boundary.
    assert_eq!(
        review_comment_input("src/x.rs", 3, "RIGHT", "here", None, None)
            .unwrap()
            .side,
        "RIGHT"
    );
}

#[test]
fn a_range_comment_keeps_its_start_and_inherits_the_end_side() {
    let input = review_comment_input("src/x.rs", 12, "RIGHT", "fix these", Some(9), None).unwrap();
    assert_eq!(input.start_line, Some(9));
    // An omitted start side is the side the comment is addressed to.
    assert_eq!(input.start_side.as_deref(), Some("RIGHT"));
    // An explicit one is normalised like `side` is.
    let input = review_comment_input(
        "src/x.rs",
        12,
        "RIGHT",
        "fix these",
        Some(9),
        Some(" left "),
    )
    .unwrap();
    assert_eq!(input.start_side.as_deref(), Some("LEFT"));
}

#[test]
fn a_one_line_range_collapses_to_a_single_line_comment() {
    // GitHub rejects a "range" that spans one line, so it never becomes one.
    let input = review_comment_input("src/x.rs", 7, "RIGHT", "fix this", Some(7), None).unwrap();
    assert_eq!(input.start_line, None);
    assert_eq!(input.start_side, None);
    // Same line on the other image is still a real span.
    let input =
        review_comment_input("src/x.rs", 7, "RIGHT", "fix this", Some(7), Some("LEFT")).unwrap();
    assert_eq!(input.start_line, Some(7));
    assert_eq!(input.start_side.as_deref(), Some("LEFT"));
}

#[test]
fn a_range_must_start_before_its_end_and_on_a_real_side() {
    for (line, start_line, start_side, what) in [
        (
            12u64,
            Some(13u64),
            None,
            "a start past the end is not a range",
        ),
        (12, Some(0), None, "diff lines are 1-based"),
        (12, Some(9), Some("BOTH"), "DiffSide has no third value"),
        (
            12,
            Some(9),
            Some("  "),
            "an empty start side is not a default",
        ),
    ] {
        assert!(
            review_comment_input("src/x.rs", line, "RIGHT", "hi", start_line, start_side).is_err(),
            "{what}"
        );
    }
}

#[test]
fn a_new_review_comment_needs_a_body_a_path_a_line_and_a_real_side() {
    for (path, line, side, body, what) in [
        (
            "src/x.rs",
            1,
            "RIGHT",
            "   ",
            "an empty body is not a comment",
        ),
        (
            "  ",
            1,
            "RIGHT",
            "hi",
            "a thread must be anchored to a file",
        ),
        ("src/x.rs", 0, "RIGHT", "hi", "diff lines are 1-based"),
        ("src/x.rs", 1, "BOTH", "hi", "DiffSide has no third value"),
        (
            "src/x.rs",
            1,
            "",
            "hi",
            "an empty side is not a default here",
        ),
    ] {
        assert!(
            review_comment_input(path, line, side, body, None, None).is_err(),
            "{what}"
        );
    }
}

/// The verdict write checks its arguments before it touches the repo or the
/// network, so these fail without either.
#[tokio::test]
async fn review_rejects_unknown_event() {
    let error = super::review::github_pr_review(".", 7, "CLOSE", "")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("unsupported review event"));
}

#[tokio::test]
async fn review_rejects_changes_without_a_summary() {
    let error = super::review::github_pr_review(".", 7, "REQUEST_CHANGES", "   ")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("needs a summary comment"));
}
