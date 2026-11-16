//! Stop rules: the fix loop stops for the owner and follows the decision.

use super::fixer::{
    fix_prompts, fix_task, loop_event, next_commit, replies, reply, state, until, wake,
};
use super::*;
use wire::{KeeperDecision, KeeperFindingStatus as Status, KeeperLoopStatus, KeeperStop};

async fn decide(setup: &Setup, decision: KeeperDecision, rounds: u32, note: Option<&str>) {
    ask(setup, |reply| KeeperCommand::Decide {
        task_id: "t_a".into(),
        keeper_id: "review".into(),
        decision,
        rounds: Some(rounds),
        note: note.map(str::to_string),
        reply,
    })
    .await
    .unwrap();
}

/// Rounds count per HEAD up to `max_rounds`; Extend adds one with guidance;
/// a run with no fewer findings stops it; Accept quiets it; Off ends it.
#[tokio::test]
async fn the_loop_stops_for_the_owner_and_follows_the_decision() {
    let keeper = "version: 1\npreset: review\nagent: mockkeep\nmax_rounds: 2\n";
    let mut setup = setup(&[("review", keeper)], |wt| vec![fix_task("t_a", wt)]).await;
    replies(
        &setup,
        &[
            reply(&["a", "b", "c"]),
            reply(&["d", "e"]),
            reply(&["f"]),
            reply(&["g"]),
            reply(&["h"]),
        ],
    );
    wake(&setup, "hello").await;
    until("round 1", || fix_prompts(&setup).len() == 1).await;
    wait_idle(&setup.daemon, "t_a").await;
    next_commit(&mut setup, "sha2").await;
    until("round 2", || fix_prompts(&setup).len() == 2).await;
    let state2 = state(&setup).await;
    let fixed = state2.findings.iter().filter(|f| f.status == Status::Fixed);
    assert_eq!(fixed.count(), 3, "a, b and c were not reported again");
    wait_idle(&setup.daemon, "t_a").await;

    next_commit(&mut setup, "sha3").await;
    let stopped = loop_event(&mut setup, |s| s.status == KeeperLoopStatus::NeedsYou).await;
    assert_eq!(
        (stopped.stop, stopped.rounds),
        (Some(KeeperStop::MaxRounds), 2)
    );
    assert_eq!(fix_prompts(&setup).len(), 2);

    decide(
        &setup,
        KeeperDecision::Extend,
        2,
        Some("keep the API stable"),
    )
    .await;
    until("round 3", || fix_prompts(&setup).len() == 3).await;
    assert!(fix_prompts(&setup)[2].contains("- Review: keep the API stable"));
    let extended = state(&setup).await.loops["review"].clone();
    assert_eq!((extended.rounds, extended.max_rounds), (3, 4));
    wait_idle(&setup.daemon, "t_a").await;

    next_commit(&mut setup, "sha4").await;
    let stalled = loop_event(&mut setup, |s| s.status == KeeperLoopStatus::NeedsYou).await;
    assert_eq!(stalled.stop, Some(KeeperStop::NoProgress));

    decide(&setup, KeeperDecision::Accept, 0, None).await;
    let accepted = state(&setup).await;
    assert_eq!(accepted.loops["review"].status, KeeperLoopStatus::Accepted);
    assert_eq!(accepted.loops["review"].rounds, 0);
    assert_eq!(fix_prompts(&setup).len(), 3);

    decide(&setup, KeeperDecision::Off, 0, None).await;
    let off = setup.daemon.tasks().await;
    let switches = off.iter().find(|t| t.id == "t_a").unwrap().keepers.clone();
    assert_eq!(switches.unwrap().overrides.get("review"), Some(&false));
    let runs = state(&setup).await.runs.len();
    move_head(&setup, "sha5").await;
    commit(&setup, "t_a").await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(state(&setup).await.runs.len(), runs, "off: no more checks");
    setup.daemon.shutdown().await;
}
