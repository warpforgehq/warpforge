use super::*;

#[tokio::test]
async fn workflow_plan_question_reply_flow() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Q flow\nplan: {{}}\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    // Plan turn 1 asks, the answered turn plans, then implement runs.
    let lead = wf_agent(&dir, "lead.state", "question plan impl");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let waiting = wait_for_parent(&mut events, &parent_id, "question", |t| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Question)
    })
    .await;
    assert_eq!(waiting.status, TaskStatus::Waiting);
    let question = waiting.workflow_run.unwrap().waiting.unwrap();
    assert_eq!(question.question.as_deref(), Some("Which database?"));
    assert_eq!(question.stage, Some(wire::WorkflowStage::Plan));
    let asking_child = daemon
        .tasks()
        .await
        .into_iter()
        .find(|task| task.parent_task_id.as_deref() == Some(&parent_id))
        .expect("asking plan stage");
    assert_eq!(asking_child.status, TaskStatus::Waiting);

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowReply {
            task: parent_id.clone(),
            message: "Postgres".into(),
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("reply accepted");

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
    assert_eq!(done.workflow_run.unwrap().round, 1);
}

#[tokio::test]
async fn workflow_limit_asks_and_finishes_on_decision() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "reject");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!(
            "name: Limit flow\nreview:\n  max_rounds: 1\n  on_limit: ask\n  reviewers:\n    - agent: {reviewer}\n"
        ),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "impl fix");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let waiting = wait_for_parent(&mut events, &parent_id, "limit decision", |t| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Limit)
    })
    .await;
    assert_eq!(waiting.status, TaskStatus::Waiting);
    assert!(
        daemon
            .tasks()
            .await
            .iter()
            .filter(|task| task.parent_task_id.as_deref() == Some(&parent_id))
            .all(|task| task.status == TaskStatus::Done),
        "every stage has completed when the review-limit decision is shown"
    );

    // A pause is invalid while waiting on a decision.
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowPause {
            task: parent_id.clone(),
            reply: tx,
        })
        .await;
    assert!(rx.await.unwrap().is_err());

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowDecide {
            task: parent_id.clone(),
            decision: wire::WorkflowDecision::Finish,
            rounds: None,
            note: None,
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("decision accepted");

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
    assert_eq!(
        done.workflow_run.unwrap().verdict,
        Some(wire::WorkflowVerdict::RequestChanges)
    );
}

#[tokio::test]
async fn workflow_pause_takes_effect_at_barrier_and_resumes() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Pause flow\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    // The implement turn takes ~600ms — enough for the pause to land.
    let lead = wf_agent(&dir, "impl.state", "slow-impl fix");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowPause {
            task: parent_id.clone(),
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("pause accepted while running");

    let paused = wait_for_parent(&mut events, &parent_id, "paused at barrier", |t| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Paused)
    })
    .await;
    assert_eq!(paused.status, TaskStatus::Waiting);

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowResume {
            task: parent_id.clone(),
            note: Some("carry on".into()),
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("resume accepted");

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
}

#[tokio::test]
async fn workflow_parent_cancel_stops_the_active_stage_before_acknowledging() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: Cancel flow\n");
    let pid_path = dir.path().join("cancel.pid");
    let lead = format!(
        "echo $$ > {}; exec {}",
        pid_path.display(),
        wf_agent(&dir, "cancel.state", "slow-impl")
    );
    let daemon = Daemon::spawn(
        projects,
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let pid = timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_path) {
                let pid = pid.trim();
                if pid.parse::<u32>().is_ok() {
                    break pid.to_string();
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("active stage should write its process id");

    daemon
        .cancel_task(&parent_id)
        .await
        .expect("workflow cancellation acknowledged");

    let process_alive = tokio::process::Command::new("kill")
        .args(["-0", &pid])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success());
    assert!(
        !process_alive,
        "task.cancel acknowledged before ACP process {pid} exited"
    );

    let tasks = daemon.tasks().await;
    let parent = tasks.iter().find(|task| task.id == parent_id).unwrap();
    assert_eq!(parent.status, TaskStatus::Interrupted);
    assert_eq!(
        parent.workflow_run.as_ref().map(|run| run.stage),
        Some(wire::WorkflowStage::Failed)
    );
    let child = tasks
        .iter()
        .find(|task| task.parent_task_id.as_deref() == Some(&parent_id))
        .expect("active workflow stage");
    assert_eq!(child.status, TaskStatus::Interrupted);
    assert_eq!(
        parent.orchestration_graph.as_ref().unwrap().nodes[0].status,
        wire::OrchNodeStatus::Skipped
    );
}

/// A daemon restart mid-stage parks the pipeline at its last barrier as
/// Paused; resume re-runs the interrupted stage and the run completes.
#[tokio::test]
async fn workflow_restart_converts_midstage_to_paused_and_resumes() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Restart flow\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    // Attempt 1 of implement is slow and dies with the daemon; the re-run
    // after restart pops the next behavior and completes quickly.
    let lead = wf_agent(&dir, "impl.state", "slow-impl impl fix");
    let db_path = dir.path().join("warpforge.db");

    let daemon = Daemon::spawn(projects.clone(), Store::open_at(&db_path).ok());
    let parent_id = create_workflow_task(&daemon, &lead).await;
    // Shut down while the implement turn is still in flight (~600ms).
    daemon.shutdown().await;

    let daemon = Daemon::spawn(projects, Store::open_at(&db_path).ok());
    let mut events = daemon.subscribe();
    let restored = timeout(Duration::from_secs(5), async {
        loop {
            let tasks = daemon.tasks().await;
            if let Some(task) = tasks.iter().find(|t| t.id == parent_id) {
                if task
                    .workflow_run
                    .as_ref()
                    .and_then(|w| w.waiting.as_ref())
                    .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Paused)
                {
                    break task.clone();
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("restored run should be paused at the implement barrier");
    assert_eq!(restored.status, TaskStatus::Waiting);
    assert_eq!(
        restored.workflow_run.unwrap().stage,
        wire::WorkflowStage::Implement
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowResume {
            task: parent_id.clone(),
            note: None,
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("resume accepted after restart");

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
}
