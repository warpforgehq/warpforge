//! Invariant 21: a keeper switched off while its poll or change read is in
//! flight starts no check. A second keeper that stays on shows when the
//! held read has landed.

use super::fixer::{state, until};
use super::*;

const STYLE: &str = "version: 1\npreset: review\nagent: mockkeep\n";

async fn two_keepers() -> Setup {
    let keepers = [("review", REVIEW), ("style", STYLE)];
    let setup = setup(&keepers, |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, APPROVE).unwrap();
    setup
}

async fn switch_off_review(setup: &Setup) {
    ask(setup, |reply| KeeperCommand::SetSwitch {
        task_id: "t_a".into(),
        keeper_id: "review".into(),
        on: false,
        reply,
    })
    .await
    .unwrap();
}

/// Waits for the style check the held read started, then asserts the review
/// keeper got none.
async fn only_style_checked(setup: &mut Setup) {
    let (style, _) = keeper_event(setup, |run| run.keeper_id == "style").await;
    assert_eq!(style.head_sha, "sha1");
    let runs = state(setup).await.runs;
    assert!(
        runs.iter().all(|run| run.keeper_id != "review"),
        "the review keeper is off: {runs:?}"
    );
}

#[tokio::test]
async fn a_poll_in_flight_starts_no_check_for_a_keeper_switched_off() {
    let mut setup = two_keepers().await;
    setup.script.lock().unwrap().hold_heads = true;
    commit(&setup, "t_a").await;
    until("the poll to read HEAD", || {
        !setup.script.lock().unwrap().head_reads.is_empty()
    })
    .await;
    switch_off_review(&setup).await;
    setup.script.lock().unwrap().hold_heads = false;
    only_style_checked(&mut setup).await;
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_change_read_in_flight_starts_no_check_for_a_keeper_switched_off() {
    let mut setup = two_keepers().await;
    setup.script.lock().unwrap().hold_changes = true;
    commit(&setup, "t_a").await;
    timeout(Duration::from_secs(10), async {
        while state(&setup).await.switches.head.is_none() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .expect("the poll reads HEAD and starts the change read");
    switch_off_review(&setup).await;
    setup.script.lock().unwrap().hold_changes = false;
    only_style_checked(&mut setup).await;
    setup.daemon.shutdown().await;
}
