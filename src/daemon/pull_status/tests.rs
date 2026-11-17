mod targets;

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::anyhow;
use tokio::sync::broadcast;
use warpforge_protocol as wire;

use super::gh::parse_pull_list;
use super::{CommentsFetcher, Event, Fetcher, Listed, PullTarget, PullWatch};

type Scripted = anyhow::Result<Option<wire::TaskPullRequest>>;

fn pull(state: wire::TaskPullState, checks: Option<wire::PullChecks>) -> wire::TaskPullRequest {
    wire::TaskPullRequest {
        number: 7,
        title: "Fix it".into(),
        url: "https://github.com/acme/widgets/pull/7".into(),
        state,
        checks,
        head_oid: None,
        author: None,
        failed_checks: Vec::new(),
        open_comments: Vec::new(),
    }
}

/// A fetcher that answers from a script and counts its calls.
fn scripted(answers: Vec<Scripted>) -> (Fetcher, Arc<AtomicUsize>) {
    let queue = Arc::new(Mutex::new(VecDeque::from(answers)));
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let fetch: Fetcher = Arc::new(move |_target| {
        counter.fetch_add(1, Ordering::SeqCst);
        let next = queue.lock().unwrap().pop_front().unwrap_or(Ok(None));
        let listed = next.map(|pull| {
            pull.map(|pull| Listed {
                pull,
                updated_at: String::new(),
            })
        });
        Box::pin(async move { listed })
    });
    (fetch, calls)
}

fn no_comments() -> CommentsFetcher {
    Arc::new(|_, _| Box::pin(async { Ok(Vec::new()) }))
}

fn targets(ids: &[&str]) -> HashMap<String, PullTarget> {
    ids.iter()
        .map(|id| {
            (
                id.to_string(),
                PullTarget {
                    worktree: format!("/wt/{id}"),
                    base_branch: Some("main".into()),
                    head: None,
                },
            )
        })
        .collect()
}

async fn next_pull_event(
    rx: &mut broadcast::Receiver<Event>,
) -> (String, Option<wire::TaskPullRequest>) {
    let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("no event")
        .unwrap();
    match event {
        Event::TaskPullRequest {
            task_id,
            pull_request,
        } => (task_id, pull_request),
        _ => panic!("unexpected event"),
    }
}

async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn a_change_is_pushed_once_and_a_fresh_entry_is_not_refetched() {
    let open = pull(wire::TaskPullState::Open, Some(wire::PullChecks::Pending));
    let (fetch, calls) = scripted(vec![Ok(Some(open.clone()))]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, mut rx) = broadcast::channel(16);

    let cached = watch.refresh(targets(&["t1"]), None, Duration::from_secs(60), &events);
    assert!(cached.is_empty(), "the first answer arrives as an event");
    assert_eq!(
        next_pull_event(&mut rx).await,
        ("t1".into(), Some(open.clone()))
    );

    let cached = watch.refresh(targets(&["t1"]), None, Duration::from_secs(60), &events);
    settle().await;
    assert_eq!(cached.get("t1"), Some(&open));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn a_failed_fetch_keeps_the_last_known_state() {
    let merged = pull(wire::TaskPullState::Merged, None);
    let (fetch, calls) = scripted(vec![
        Ok(Some(merged.clone())),
        Err(anyhow!("gh: not logged in")),
    ]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    next_pull_event(&mut rx).await;
    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    settle().await;

    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(rx.try_recv().is_err(), "an error must not clear the badge");
    let cached = watch.refresh(targets(&["t1"]), None, Duration::from_secs(60), &events);
    assert_eq!(cached.get("t1"), Some(&merged));
}

#[tokio::test]
async fn a_task_that_lost_its_worktree_is_cleared_on_clients() {
    let open = pull(wire::TaskPullState::Open, None);
    let (fetch, _) = scripted(vec![Ok(Some(open))]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    next_pull_event(&mut rx).await;

    let cached = watch.refresh(targets(&[]), None, Duration::ZERO, &events);
    assert!(cached.is_empty());
    assert_eq!(next_pull_event(&mut rx).await, ("t1".into(), None));
}

#[tokio::test]
async fn a_scoped_refresh_fetches_only_the_named_tasks() {
    let (fetch, calls) = scripted(vec![]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, _rx) = broadcast::channel(16);

    let only = ["t2".to_string()];
    watch.refresh(targets(&["t1", "t2"]), Some(&only), Duration::ZERO, &events);
    settle().await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn forgetting_a_task_clears_its_badge() {
    let open = pull(wire::TaskPullState::Open, None);
    let (fetch, _) = scripted(vec![Ok(Some(open))]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    next_pull_event(&mut rx).await;
    watch.forget("t1", &events);
    assert_eq!(next_pull_event(&mut rx).await, ("t1".into(), None));
}

#[test]
fn the_open_pull_request_wins_over_older_closed_ones() {
    let json = br#"[
        {"number": 9, "title": "Old", "url": "u9", "state": "CLOSED", "isDraft": false, "statusCheckRollup": []},
        {"number": 12, "title": "New", "url": "u12", "state": "OPEN", "isDraft": true, "statusCheckRollup": []}
    ]"#;
    let pull = parse_pull_list(json).unwrap().unwrap().pull;
    assert_eq!(pull.number, 12);
    assert_eq!(pull.state, wire::TaskPullState::Draft);
    assert_eq!(pull.checks, None);
}

#[test]
fn no_pull_request_reads_none_and_merged_reads_merged() {
    assert_eq!(parse_pull_list(b"[]").unwrap(), None);
    let json = br#"[{"number": 3, "title": "t", "url": "u", "state": "MERGED", "statusCheckRollup": null}]"#;
    let pull = parse_pull_list(json).unwrap().unwrap().pull;
    assert_eq!(pull.state, wire::TaskPullState::Merged);
}

#[test]
fn checks_roll_up_failure_first_then_pending() {
    let rollup = |checks: &str| {
        let json = format!(
            r#"[{{"number": 1, "title": "t", "url": "u", "state": "OPEN", "statusCheckRollup": {checks}}}]"#
        );
        parse_pull_list(json.as_bytes())
            .unwrap()
            .unwrap()
            .pull
            .checks
    };
    let passed = r#"{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"}"#;
    let skipped = r#"{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SKIPPED"}"#;
    let running = r#"{"__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": ""}"#;
    let failed = r#"{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE"}"#;
    let status_pending = r#"{"__typename": "StatusContext", "state": "PENDING"}"#;
    let status_error = r#"{"__typename": "StatusContext", "state": "ERROR"}"#;

    assert_eq!(
        rollup(&format!("[{passed},{skipped}]")),
        Some(wire::PullChecks::Passing)
    );
    assert_eq!(
        rollup(&format!("[{passed},{running}]")),
        Some(wire::PullChecks::Pending)
    );
    assert_eq!(
        rollup(&format!("[{running},{failed}]")),
        Some(wire::PullChecks::Failing)
    );
    assert_eq!(
        rollup(&format!("[{status_pending}]")),
        Some(wire::PullChecks::Pending)
    );
    assert_eq!(
        rollup(&format!("[{passed},{status_error}]")),
        Some(wire::PullChecks::Failing)
    );
}

#[test]
fn failed_checks_carry_their_name_link_and_summary() {
    let json = br#"[{"number": 4, "title": "t", "url": "u", "state": "OPEN",
        "author": {"login": "octocat"}, "updatedAt": "2026-09-29T10:00:00Z",
        "statusCheckRollup": [
            {"__typename": "CheckRun", "name": "test", "workflowName": "CI", "status": "COMPLETED",
             "conclusion": "FAILURE", "detailsUrl": "https://github.com/a/b/actions/runs/1/job/2"},
            {"__typename": "CheckRun", "name": "lint", "workflowName": "", "status": "COMPLETED",
             "conclusion": "SUCCESS", "detailsUrl": "https://x"},
            {"__typename": "StatusContext", "context": "deploy", "state": "ERROR",
             "targetUrl": "https://deploy", "description": "Build failed"}
        ]}]"#;
    let listed = parse_pull_list(json).unwrap().unwrap();
    assert_eq!(listed.updated_at, "2026-09-29T10:00:00Z");
    assert_eq!(listed.pull.author.as_deref(), Some("octocat"));
    assert_eq!(listed.pull.checks, Some(wire::PullChecks::Failing));
    let failed: Vec<(&str, &str, &str)> = listed
        .pull
        .failed_checks
        .iter()
        .map(|run| (run.name.as_str(), run.url.as_str(), run.summary.as_str()))
        .collect();
    assert_eq!(
        failed,
        vec![
            (
                "CI / test",
                "https://github.com/a/b/actions/runs/1/job/2",
                ""
            ),
            ("deploy", "https://deploy", "Build failed"),
        ]
    );
}

fn remark(id: &str, kind: &str, author: &str, state: &str, resolved: bool) -> wire::PullComment {
    wire::PullComment {
        id: id.into(),
        kind: kind.into(),
        author: Some(wire::PullActor {
            login: author.into(),
            avatar_url: None,
        }),
        body: format!("body of {id}"),
        created_at: String::new(),
        url: String::new(),
        state: state.into(),
        path: String::new(),
        line: None,
        start_line: None,
        original_line: None,
        original_start_line: None,
        diff_hunk: String::new(),
        thread_id: String::new(),
        resolved,
        replies: Vec::new(),
    }
}

#[test]
fn open_comments_keep_unresolved_threads_and_standing_change_requests() {
    let thread = wire::PullThread {
        comments: vec![
            remark("c1", "comment", "bot", "", false),
            remark("r1", "review", "alice", "CHANGES_REQUESTED", false),
            remark("t1", "review_comment", "alice", "", false),
            remark("t2", "review_comment", "bob", "", true),
            remark("r2", "review", "bob", "CHANGES_REQUESTED", false),
            remark("r3", "review", "alice", "APPROVED", false),
            remark("r4", "review", "bob", "COMMENTED", false),
        ],
        truncated: false,
        review_decision: None,
        base_ref_name: String::new(),
        head_ref_name: String::new(),
    };
    let ids: Vec<String> = super::comments::open_comments(thread)
        .into_iter()
        .map(|comment| comment.id)
        .collect();
    assert_eq!(ids, vec!["t1", "r2"]);
}

/// A fetcher that always lists one open pull request with the given
/// `updatedAt`, read from a shared cell.
fn listing(updated_at: Arc<Mutex<String>>) -> Fetcher {
    Arc::new(move |_target| {
        let listed = Listed {
            pull: pull(wire::TaskPullState::Open, None),
            updated_at: updated_at.lock().unwrap().clone(),
        };
        Box::pin(async move { Ok(Some(listed)) })
    })
}

fn counted_comments(
    answers: Vec<anyhow::Result<Vec<wire::PullComment>>>,
) -> (CommentsFetcher, Arc<AtomicUsize>) {
    let queue = Arc::new(Mutex::new(VecDeque::from(answers)));
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let fetch: CommentsFetcher = Arc::new(move |_, _| {
        counter.fetch_add(1, Ordering::SeqCst);
        let next = queue.lock().unwrap().pop_front().unwrap_or(Ok(Vec::new()));
        Box::pin(async move { next })
    });
    (fetch, calls)
}

#[tokio::test]
async fn remarks_are_read_again_only_when_the_pull_request_moved() {
    let updated_at = Arc::new(Mutex::new("t0".to_string()));
    let first = remark("t1", "review_comment", "alice", "", false);
    let (comments, calls) = counted_comments(vec![
        Ok(vec![first.clone()]),
        Ok(vec![
            first.clone(),
            remark("t2", "review_comment", "bob", "", false),
        ]),
    ]);
    let watch = Arc::new(PullWatch::new(listing(Arc::clone(&updated_at)), comments));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    let (_, pull) = next_pull_event(&mut rx).await;
    assert_eq!(pull.unwrap().open_comments, vec![first.clone()]);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    settle().await;
    assert_eq!(calls.load(Ordering::SeqCst), 1, "updatedAt stood still");
    assert!(rx.try_recv().is_err());

    *updated_at.lock().unwrap() = "t1".into();
    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    let (_, pull) = next_pull_event(&mut rx).await;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(pull.unwrap().open_comments.len(), 2);
}

#[tokio::test]
async fn a_failed_remarks_read_keeps_the_known_ones_and_retries() {
    let updated_at = Arc::new(Mutex::new("t0".to_string()));
    let first = remark("t1", "review_comment", "alice", "", false);
    let (comments, calls) = counted_comments(vec![
        Ok(vec![first.clone()]),
        Err(anyhow!("offline")),
        Ok(vec![first.clone()]),
    ]);
    let watch = Arc::new(PullWatch::new(listing(Arc::clone(&updated_at)), comments));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    next_pull_event(&mut rx).await;
    *updated_at.lock().unwrap() = "t1".into();
    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    settle().await;
    assert!(
        rx.try_recv().is_err(),
        "a failed read must not clear the remarks"
    );

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    settle().await;
    assert_eq!(
        calls.load(Ordering::SeqCst),
        3,
        "the failed read is retried"
    );
}

#[tokio::test]
async fn a_merged_pull_request_costs_no_remarks_read() {
    let (fetch, _) = scripted(vec![Ok(Some(pull(wire::TaskPullState::Merged, None)))]);
    let (comments, calls) = counted_comments(vec![]);
    let watch = Arc::new(PullWatch::new(fetch, comments));
    let (events, mut rx) = broadcast::channel(16);

    watch.refresh(targets(&["t1"]), None, Duration::ZERO, &events);
    next_pull_event(&mut rx).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}
