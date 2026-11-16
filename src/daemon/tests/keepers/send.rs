//! **Send to agent**: the owner hands a keeper's open findings to the task's
//! agent even after HEAD moved, and never into a busy session.

use super::fixer::{fix_prompts, fix_task, state, until};
use super::*;
use wire::{KeeperFindingStatus as Status, KeeperLoopStatus, KeeperOutcome as Outcome};

const SECURITY: &str = "version: 1\npreset: security\nagent: mockkeep\n";

/// A ready check finds one problem on sha1 and HEAD moves to sha2 meanwhile,
/// so the automatic fix drops it and the finding stays open.
async fn findings_left_behind() -> Setup {
    let mut setup = setup(&[("security", SECURITY)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.replies, "WAIT").unwrap();
    assert_eq!(check_ready(&setup).await, vec!["security"]);
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
async fn sending_into_a_dirty_tree_warns_the_agent_and_spares_a_changed_finding_file() {
    let setup = findings_left_behind().await;
    let tree = setup.worktree.clone();
    let changed = vec!["README.md".to_string(), "src/lib.rs".to_string()];
    setup
        .script
        .lock()
        .unwrap()
        .changed_files
        .insert(tree.clone(), changed);
    let error = send_findings(&setup, "security").await.unwrap_err();
    assert!(
        error.starts_with("src/lib.rs has uncommitted changes"),
        "{error}"
    );
    assert!(fix_prompts(&setup).is_empty());

    let changed = vec!["README.md".to_string()];
    setup
        .script
        .lock()
        .unwrap()
        .changed_files
        .insert(tree, changed);
    send_findings(&setup, "security").await.unwrap();
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    assert!(
        prompt.contains("uncommitted changes that are not yours"),
        "{prompt}"
    );
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn sending_is_refused_mid_turn() {
    let setup = findings_left_behind().await;
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
    assert_eq!(check_ready(&setup).await, vec!["security"]);
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(Outcome::Green));
    let error = send_findings(&setup, "security").await.unwrap_err();
    assert_eq!(error, "this keeper has no open findings to send");
    assert!(!setup.fix_log.exists(), "the task's agent was not woken");
    setup.daemon.shutdown().await;
}
