//! A fix turn's end closes the fix whatever initiator the harness reports.

use super::fixer::{fix_prompts, fix_task, loop_event, state, until};
use super::*;
use crate::daemon::acp::{AcpUpdate, TurnInitiator};
use wire::KeeperLoopStatus;

#[tokio::test]
async fn the_first_turn_end_after_a_fix_closes_it_whatever_its_initiator() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.hold, "Keepers checked").unwrap();
    setup
        .daemon
        .session_prompt("t_a", "hello", Vec::new())
        .await
        .unwrap();
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    loop_event(&mut setup, |s| s.status == KeeperLoopStatus::Fixing).await;

    // Run ids are process-wide; only the fixer session's own id passes the
    // stale-run check, so exactly one of these ends its held turn.
    for run_id in 0..20_000 {
        let update = AcpUpdate::TurnEnded {
            run_id,
            stop_reason: "end_turn".into(),
            initiator: TurnInitiator::User,
            interrupted: false,
        };
        let inject = Command::InjectAcpUpdate {
            task_id: "t_a".into(),
            update,
        };
        setup.daemon.send(inject).await;
    }
    let idle = loop_event(&mut setup, |s| s.status == KeeperLoopStatus::Idle).await;
    assert_eq!(idle.rounds, 1);
    let fix = &state(&setup).await.switches.loops["review"];
    assert_eq!((fix.rounds, fix.pending_head.as_deref()), (1, None));
    setup.daemon.shutdown().await;
}
