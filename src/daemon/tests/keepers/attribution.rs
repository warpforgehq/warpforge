//! A commit belongs to the session whose turn was running when HEAD moved,
//! not to one whose turn began just after it.

use super::checkout::{move_checkout_head, on_branch, switches, until_branch};
use super::fixer::{fix_task, prompts, until};
use super::*;

/// The orchestrator's turn starts right after a sub-agent's commit, before any
/// poll sees it: the turn reads HEAD itself, so its end does not take the
/// branch for it.
#[tokio::test]
async fn a_turn_that_began_after_the_commit_does_not_take_it() {
    let mut setup = setup(&[("review", REVIEW)], |wt| {
        let mut late = fix_task("t_b", wt);
        late.worktree = None;
        vec![task("t_a", None), late]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;
    // A finishing check polls again; let it finish so no poll sees the new
    // HEAD before t_b's turn starts.
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    tokio::time::sleep(Duration::from_millis(200)).await;

    move_checkout_head(&setup, "sha2").await;
    setup
        .daemon
        .session_prompt("t_b", "what changed?", Vec::new())
        .await
        .unwrap();
    until("t_b's turn", || prompts(&setup.fix_log).len() == 1).await;
    timeout(Duration::from_secs(10), async {
        loop {
            let task = setup
                .daemon
                .tasks()
                .await
                .into_iter()
                .find(|t| t.id == "t_b");
            if task.is_some_and(|t| t.status != TaskStatus::Running) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("t_b's turn ends");
    for _ in 0..5 {
        setup
            .daemon
            .send(Command::Keepers(KeeperCommand::Poll))
            .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(
        switches(&setup.daemon, "t_b").await.branch,
        None,
        "nor does its end"
    );
    assert_eq!(
        switches(&setup.daemon, "t_a").await.branch.as_deref(),
        Some("feat/x")
    );
    setup.daemon.shutdown().await;
}
