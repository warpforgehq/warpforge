//! **Send to agent**: the owner hands a keeper's open findings to the task's
//! agent even after HEAD moved, and never into a busy session.

use super::fixer::{fix_prompts, fix_task, state, until};
use super::*;
use wire::{KeeperFindingStatus as Status, KeeperLoopStatus, KeeperOutcome as Outcome};

const SECURITY: &str = "version: 1\npreset: security\nagent: mockkeep\n";

async fn check_ready(setup: &Setup) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::CheckReady {
        task_id: "t_a".into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    let (_, started) = rx.await.unwrap().unwrap();
    assert_eq!(started, vec!["security"]);
}

async fn send_findings(setup: &Setup, keeper_id: &str) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::SendFindings {
        task_id: "t_a".into(),
        keeper_id: keeper_id.into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    rx.await.unwrap()
}

/// A ready check finds one problem on sha1 and HEAD moves to sha2 meanwhile,
/// so the automatic fix drops it and the finding stays open.
async fn findings_left_behind() -> Setup {
    let mut setup = setup(&[("security", SECURITY)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.replies, "WAIT").unwrap();
    check_ready(&setup).await;
    keeper_event(&mut setup, |run| run.checker_task_id.is_some()).await;
    move_head(&setup, "sha2").await;
    std::fs::write(format!("{}.go", setup.replies.display()), FINDING).unwrap();
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(Outcome::Findings));
    timeout(Duration::from_secs(10), async {
        while state(&setup).await.loops["security"].status != KeeperLoopStatus::Idle {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .expect("the automatic fix is dropped");
    setup
}

#[tokio::test]
async fn findings_on_an_older_head_are_sent_naming_their_commit() {
    let setup = findings_left_behind().await;
    assert!(fix_prompts(&setup).is_empty());
    send_findings(&setup, "security").await.unwrap();
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    assert!(prompt.contains("commit sha1"), "{prompt}");
    assert!(
        prompt.contains("HEAD may have moved since sha1"),
        "{prompt}"
    );
    assert!(
        prompt.contains("[Security, high] src/lib.rs:4 — panics"),
        "{prompt}"
    );
    let state = state(&setup).await;
    assert!(state.findings.iter().all(|f| f.status == Status::Sent));
    assert_eq!(state.switches.loops["security"].rounds, 1);
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn sending_is_refused_into_a_dirty_tree_or_mid_turn() {
    let setup = findings_left_behind().await;
    let dirty = setup.worktree.clone();
    setup.script.lock().unwrap().dirty.insert(dirty.clone());
    let error = send_findings(&setup, "security").await.unwrap_err();
    assert_eq!(error, "the worktree has uncommitted changes");
    setup.script.lock().unwrap().dirty.remove(&dirty);

    std::fs::write(&setup.hold, "busy turn").unwrap();
    setup
        .daemon
        .session_prompt("t_a", "busy turn", Vec::new())
        .await
        .unwrap();
    let error = send_findings(&setup, "security").await.unwrap_err();
    assert_eq!(error, "the task's agent is working");
    let state = state(&setup).await;
    assert!(state.findings.iter().all(|f| f.status == Status::Open));
    assert!(fix_prompts(&setup).is_empty());
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn sending_is_refused_with_nothing_open() {
    let mut setup = setup(&[("security", SECURITY)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.replies, APPROVE).unwrap();
    check_ready(&setup).await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(Outcome::Green));
    let error = send_findings(&setup, "security").await.unwrap_err();
    assert_eq!(error, "this keeper has no open findings to send");
    assert!(!setup.fix_log.exists(), "the task's agent was not woken");
    setup.daemon.shutdown().await;
}
