//! The fixer's replies: a fix turn's closing block notes a verdict on the
//! findings it did not fix, and only the owner's Accept resolves them.

use super::fixer::{
    fix_prompts, fix_task, loop_event, next_commit, replies, reply, state, until, wake,
};
use super::*;
use wire::{KeeperFindingStatus as Status, KeeperLoopStatus, KeeperReplyVerdict as Verdict};

const ANSWER: &str = "Fixed the second one.\n```json\n{\"keepers\": [{\"n\": 1, \"verdict\": \
\"rebutted\", \"reason\": \"the caller validates it\"}, {\"n\": 3, \"verdict\": \"stale\", \
\"reason\": \"gone since sha0\"}]}\n```";

/// Three findings on sha1 go to the fixer, which answers with `answer`; the
/// fix turn has closed when this returns.
async fn answered(answer: &str) -> Setup {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    replies(
        &setup,
        &[reply(&["first", "second", "third"]), reply(&["first"])],
    );
    std::fs::write(format!("{}.reply", setup.fix_log.display()), answer).unwrap();
    wake(&setup, "hello").await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    for (n, description) in ["first", "second", "third"].iter().enumerate() {
        let line = format!("[{}] [Review, high] src/lib.rs — {description}", n + 1);
        assert!(prompt.contains(&line), "{prompt}");
    }
    loop_event(&mut setup, |s| s.status == KeeperLoopStatus::Fixing).await;
    loop_event(&mut setup, |s| s.status == KeeperLoopStatus::Idle).await;
    setup
}

fn finding(state: &wire::KeeperTaskState, description: &str) -> wire::KeeperFinding {
    let found = state.findings.iter().find(|f| f.description == description);
    found.cloned().expect("the finding")
}

async fn accept(setup: &Setup, finding_id: &str) -> Result<(), String> {
    ask(setup, |reply| KeeperCommand::AcceptReply {
        task_id: "t_a".into(),
        finding_id: finding_id.into(),
        reply,
    })
    .await
}

#[tokio::test]
async fn the_closing_block_notes_replies_and_accept_resolves_them() {
    let setup = answered(ANSWER).await;
    let before = state(&setup).await;
    let (first, second, third) = (
        finding(&before, "first"),
        finding(&before, "second"),
        finding(&before, "third"),
    );
    assert!([&first, &second, &third]
        .iter()
        .all(|f| f.status == Status::Sent));
    let rebutted = first.reply.as_ref().expect("a reply on the first");
    assert_eq!(rebutted.verdict, Verdict::Rebutted);
    assert_eq!(rebutted.reason, "the caller validates it");
    assert_eq!(second.reply, None);
    assert_eq!(
        third.reply.as_ref().map(|r| r.verdict),
        Some(Verdict::Stale)
    );

    let error = accept(&setup, &second.id).await.unwrap_err();
    assert_eq!(error, "the agent did not answer that finding");
    accept(&setup, &first.id).await.unwrap();
    accept(&setup, &third.id).await.unwrap();
    let state = state(&setup).await;
    let first = finding(&state, "first");
    assert_eq!(first.status, Status::Dismissed);
    assert_eq!(
        first.dismiss_reason.as_deref(),
        Some("the caller validates it")
    );
    let third = finding(&state, "third");
    assert_eq!(third.status, Status::Fixed);
    assert!(third.resolved_at.is_some());
    assert_eq!(finding(&state, "second").status, Status::Sent);
    let precision = state.precision.iter().find(|p| p.keeper_id == "review");
    let precision = precision.expect("review's precision");
    assert_eq!((precision.fixed, precision.dismissed), (1, 1));
    let error = accept(&setup, &first.id).await.unwrap_err();
    assert_eq!(error, "that finding is already resolved");
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn sending_again_rejects_the_replies_and_carries_only_the_answered() {
    let setup = answered(ANSWER).await;
    std::fs::remove_file(format!("{}.reply", setup.fix_log.display())).unwrap();
    send_findings(&setup, "review").await.unwrap();
    until("the second fix prompt", || fix_prompts(&setup).len() == 2).await;
    let prompt = &fix_prompts(&setup)[1];
    assert!(prompt.contains("[1] [Review, high] src/lib.rs — first"));
    assert!(prompt.contains("[2] [Review, high] src/lib.rs — third"));
    assert!(!prompt.contains("second"), "{prompt}");
    let state = state(&setup).await;
    assert!(state.findings.iter().all(|f| f.reply.is_none()));
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_malformed_block_notes_nothing_and_the_turn_still_closes() {
    let setup = answered("```json\n{\"keepers\": [{\"n\": 1, \"verdict\":\n```").await;
    let state = state(&setup).await;
    assert_eq!(state.findings.len(), 3);
    assert!(state.findings.iter().all(|f| f.reply.is_none()));
    assert!(state.findings.iter().all(|f| f.status == Status::Sent));
    let fix = &state.switches.loops["review"];
    assert_eq!((fix.rounds, fix.pending_head.as_deref()), (1, None));
    let error = accept(&setup, &state.findings[0].id).await.unwrap_err();
    assert_eq!(error, "the agent did not answer that finding");
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_rebutted_finding_raised_again_after_a_commit_keeps_its_reply_and_is_not_resent() {
    let mut setup = answered(ANSWER).await;
    wait_idle(&setup.daemon, "t_a").await;
    next_commit(&mut setup, "sha2").await;
    let now = state(&setup).await;
    let latest = now.runs.iter().max_by_key(|run| run.run_number).unwrap();
    let again = now
        .findings
        .iter()
        .find(|f| f.run_id == latest.id && f.description == "first")
        .expect("first, raised again");
    assert_eq!(again.status, Status::Open);
    let carried = again.reply.as_ref().expect("the reply carried over");
    assert_eq!(carried.reason, "the caller validates it");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        fix_prompts(&setup).len(),
        1,
        "an answered finding waits for the owner"
    );
    accept(&setup, &again.id).await.unwrap();
    let after = state(&setup).await;
    let dismissed = after.findings.iter().find(|f| f.id == again.id).unwrap();
    assert_eq!(dismissed.status, Status::Dismissed);
    setup.daemon.shutdown().await;
}
