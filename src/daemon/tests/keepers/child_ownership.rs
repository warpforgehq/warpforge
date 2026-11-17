//! Descendants share branch ownership with their root orchestrator.
use super::checkout::{on_branch, switches, until_branch};
use super::*;

#[tokio::test]
async fn child_turn_preserves_root_findings_and_parent_reclaims_after_sibling() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        let mut child = task("t_child", None);
        child.parent_task_id = Some("t_middle".into());
        let mut middle = task("t_middle", None);
        middle.parent_task_id = Some("t_parent".into());
        vec![
            task("t_parent", None),
            middle,
            child,
            task("t_sibling", None),
        ]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_parent").await;
    let (_, findings) = keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_parent").await;
    assert!(!findings.is_empty());

    commit(&setup, "t_child").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    // Wait for the child's poll to land, including its ownership decision.
    timeout(Duration::from_secs(10), async {
        loop {
            if switches(&setup.daemon, "t_child").await.held.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        switches(&setup.daemon, "t_parent").await.branch.as_deref(),
        Some("feat/x")
    );
    assert_eq!(switches(&setup.daemon, "t_child").await.branch, None);
    let state = ask(&setup, |reply| KeeperCommand::State {
        task_id: "t_parent".into(),
        reply,
    })
    .await
    .unwrap();
    for finding in findings {
        assert_eq!(
            state
                .findings
                .iter()
                .find(|f| f.id == finding.id)
                .unwrap()
                .status,
            wire::KeeperFindingStatus::Open
        );
    }

    commit(&setup, "t_sibling").await;
    until_branch(&setup, "t_sibling", Some("feat/x")).await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_sibling").await;
    super::checkout::move_checkout_head(&setup, "sha2").await;
    commit(&setup, "t_parent").await;
    until_branch(&setup, "t_parent", Some("feat/x")).await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_parent").await;
    assert_eq!(switches(&setup.daemon, "t_sibling").await.branch, None);
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_child_with_its_own_worktree_keeps_independent_ownership() {
    let mut setup = setup(&[("review", REVIEW)], |wt| {
        let mut child = task("t_child", Some(wt));
        child.parent_task_id = Some("t_parent".into());
        vec![task("t_parent", None), child]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_parent").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_parent").await;
    commit(&setup, "t_child").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_child").await;
    assert_eq!(
        switches(&setup.daemon, "t_parent").await.branch.as_deref(),
        Some("feat/x")
    );
    setup.daemon.shutdown().await;
}
