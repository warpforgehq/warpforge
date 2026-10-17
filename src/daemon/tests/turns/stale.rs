//! Turn updates that arrive after their session was dropped: the task was
//! cancelled, failed or handed a new session while they sat in the channel.

use super::*;
use crate::daemon::acp::{AcpUpdate, TurnInitiator};

async fn inject(daemon: &DaemonHandle, task_id: &str, update: AcpUpdate) {
    daemon
        .send(Command::InjectAcpUpdate {
            task_id: task_id.into(),
            update,
        })
        .await;
}

fn turn_started() -> AcpUpdate {
    AcpUpdate::TurnStarted {
        run_id: 0,
        initiator: TurnInitiator::User,
        echo: None,
        peer: Default::default(),
        smith: None,
    }
}

async fn status_of(daemon: &DaemonHandle, task_id: &str) -> TaskStatus {
    daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == task_id)
        .expect("the task")
        .status
}

#[tokio::test]
async fn a_turn_start_queued_behind_a_cancel_leaves_the_task_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log, _gate) = gated_serial_agent(dir.path());
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let task = daemon
        .create_task(
            "demo",
            "PROMPT_A",
            &agent,
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            HashMap::new(),
            None,
        )
        .await;
    wait_for_line(&log, "turn1:start").await;
    daemon.cancel_task(&task).await.unwrap();
    assert_eq!(status_of(&daemon, &task).await, TaskStatus::Waiting);

    inject(&daemon, &task, turn_started()).await;
    assert_eq!(
        status_of(&daemon, &task).await,
        TaskStatus::Waiting,
        "no session, so nothing is running"
    );
    daemon.shutdown().await;
}

/// The agent died mid-stage; the Error path parked the run once. A turn
/// start and end still in the channel for that child change nothing.
#[tokio::test]
async fn a_dead_stages_late_turn_updates_do_not_move_the_pipeline() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Lost agent\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "die impl");
    let daemon = Daemon::spawn(projects, Store::open_at(Path::new(":memory:")).ok());
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;
    let parked = |t: &Task| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.pause_reason == Some(wire::WorkflowPauseReason::AgentLost))
    };
    wait_for_parent(&mut events, &parent_id, "paused after lost agent", parked).await;
    let child = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.parent_task_id.as_deref() == Some(parent_id.as_str()))
        .expect("the implement child")
        .id;

    inject(&daemon, &child, turn_started()).await;
    inject(
        &daemon,
        &child,
        AcpUpdate::TurnEnded {
            run_id: 0,
            stop_reason: "end_turn".into(),
            initiator: TurnInitiator::System,
            interrupted: false,
        },
    )
    .await;
    assert_ne!(status_of(&daemon, &child).await, TaskStatus::Running);
    let parent = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == parent_id)
        .unwrap();
    assert!(
        parked(&parent),
        "still parked once, not advanced or failed again"
    );
    assert_eq!(
        parent.workflow_run.unwrap().stage,
        wire::WorkflowStage::Implement
    );
}
