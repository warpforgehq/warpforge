use super::*;

#[tokio::test]
async fn workflow_full_loop_reject_fix_approve() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    // Round 1 rejects with one high finding, round 2 approves.
    let reviewer = wf_agent(&dir, "rev.state", "reject approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!(
            "name: Test flow\nreview:\n  max_rounds: 2\n  reviewers:\n    - agent: {reviewer}\n"
        ),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "impl fix");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;

    assert_eq!(done.status, TaskStatus::Waiting);
    let run = done.workflow_run.unwrap();
    assert_eq!(run.round, 2, "reject → fix → approve takes two rounds");
    assert_eq!(run.verdict, Some(wire::WorkflowVerdict::Approve));
    assert!(run.waiting.is_none());
    // Graph: implement, review r1, fix, review r2 — all with task ids.
    let graph = done.orchestration_graph.unwrap();
    assert_eq!(graph.nodes.len(), 4, "{:?}", graph.nodes);
    assert!(graph.nodes.iter().all(|n| n.task_id.is_some()));
    assert_eq!(graph.nodes[0].kind, wire::OrchNodeKind::Implement);
    assert_eq!(graph.nodes[2].kind, wire::OrchNodeKind::Fix);
    // Default reask mode: round 2 follows up in the SAME reviewer session,
    // so both review nodes point at one task.
    assert_eq!(graph.nodes[1].kind, wire::OrchNodeKind::Review);
    assert_eq!(graph.nodes[3].kind, wire::OrchNodeKind::Review);
    assert_eq!(
        graph.nodes[1].task_id, graph.nodes[3].task_id,
        "same_session re-review must continue the round-1 reviewer session"
    );

    // The parent conversation is a useful workflow narrative, not just a
    // sequence of opaque/coalesced stage transitions. Agent cards and
    // results remain independent, ordered history entries.
    let snapshot = daemon.snapshot().await;
    let history = daemon
        .session_history(parent_id.clone())
        .await
        .unwrap_or_default();
    let workflow_events: Vec<_> = history
        .iter()
        .filter(|update| matches!(update, wire::SessionUpdate::WorkflowEvent { .. }))
        .collect();
    assert!(matches!(
        workflow_events.first(),
        Some(wire::SessionUpdate::WorkflowEvent {
            event: wire::WorkflowEventKind::WorkflowStarted,
            ..
        })
    ));
    let implement_started = workflow_events
        .iter()
        .position(|update| {
            matches!(
                update,
                wire::SessionUpdate::WorkflowEvent {
                    event: wire::WorkflowEventKind::StageStarted,
                    stage: Some(wire::WorkflowStage::Implement),
                    agents,
                    ..
                } if agents.len() == 1
            )
        })
        .unwrap();
    let implement_summary = workflow_events
        .iter()
        .position(|update| {
            matches!(
                update,
                wire::SessionUpdate::WorkflowEvent {
                    event: wire::WorkflowEventKind::AgentOutput,
                    detail: Some(detail),
                    ..
                } if detail.contains("IMPL-DONE: implemented the change.")
            )
        })
        .unwrap();
    let first_review = workflow_events
        .iter()
        .position(|update| {
            matches!(
                update,
                wire::SessionUpdate::WorkflowEvent {
                    event: wire::WorkflowEventKind::StageStarted,
                    stage: Some(wire::WorkflowStage::Review),
                    ..
                }
            )
        })
        .unwrap();
    // The finding reaches the timeline through the round's merged-verdict
    // entry. The reviewer's own card shows its prose, NOT the raw protocol
    // JSON it was asked to emit — that is stripped for display.
    let finding = workflow_events
        .iter()
        .position(|update| {
            matches!(
                update,
                wire::SessionUpdate::WorkflowEvent { detail: Some(detail), .. }
                    if detail.contains("bug here")
            )
        })
        .expect("the merged verdict lists the finding");
    assert!(
        workflow_events.iter().all(|update| !matches!(
            update,
            wire::SessionUpdate::WorkflowEvent { detail: Some(detail), .. }
                if detail.contains("\"verdict\"")
        )),
        "the machine protocol block must not leak into the parent's timeline"
    );
    let fix_summary = workflow_events
        .iter()
        .position(|update| {
            matches!(
                update,
                wire::SessionUpdate::WorkflowEvent {
                    event: wire::WorkflowEventKind::AgentOutput,
                    detail: Some(detail),
                    ..
                } if detail.contains("FIX-DONE: addressed the findings.")
            )
        })
        .unwrap();
    assert!(implement_started < implement_summary);
    assert!(implement_summary < first_review);
    assert!(first_review < finding);
    assert!(finding < fix_summary);
    assert!(workflow_events.iter().any(|update| matches!(
        update,
        wire::SessionUpdate::WorkflowEvent {
            event: wire::WorkflowEventKind::ReviewResult,
            title,
            ..
        } if title.contains("approved")
    )));
    assert!(
        snapshot
            .tasks
            .iter()
            .filter(|task| task.parent_task_id.as_deref() == Some(&parent_id))
            .all(|task| task.status == wire::TaskStatus::Done),
        "consumed workflow stages should be terminal, not idle/needs-review"
    );
    assert_eq!(
        snapshot
            .tasks
            .iter()
            .filter(|task| task.parent_task_id.as_deref() == Some(&parent_id))
            .count(),
        3,
        "implement, one reused reviewer session, fix"
    );
    // Finalize must sweep every stage session — completed ones included —
    // so no mock agent processes outlive the pipeline.
    assert_no_stage_processes(&dir).await;
}

/// Poll until no mock agent process whose command line references this
/// test's tempdir remains alive. Stage sessions are kept alive during a
/// run (same-session re-review follows up in them) and must all be killed
/// at finalize.
async fn assert_no_stage_processes(dir: &tempfile::TempDir) {
    let needle = dir.path().to_string_lossy().into_owned();
    for _ in 0..50 {
        let alive = std::process::Command::new("pgrep")
            .args(["-f", &needle])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !alive {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("stage agent processes still alive after the pipeline finished");
}

/// Reviewers must receive the implementer's closing message, not the
/// whole turn's tool narration.
#[tokio::test]
async fn workflow_carries_the_closing_message_not_the_narration() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Closing flow\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "noisy-impl");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;

    // The reviewer child's prompt is its task prompt.
    let snapshot = daemon.snapshot().await;
    let reviewer_prompt = snapshot
        .tasks
        .iter()
        .find(|t| t.parent_task_id.as_deref() == Some(&parent_id) && t.title.starts_with("review"))
        .map(|t| t.prompt.clone())
        .expect("a reviewer stage ran");
    assert!(
        reviewer_prompt.contains("CLOSING: implemented the change"),
        "the reviewer must see the closing message"
    );
    assert!(
        !reviewer_prompt.contains("NARRATION:"),
        "tool narration must not be passed off as the implementer's summary"
    );

    // The parent's timeline shows the same closing text as the stage result.
    let history = daemon
        .session_history(parent_id.clone())
        .await
        .unwrap_or_default();
    let events: Vec<_> = history
        .iter()
        .filter_map(|update| match update {
            wire::SessionUpdate::WorkflowEvent { detail, .. } => detail.clone(),
            _ => None,
        })
        .collect();
    assert!(
        events.iter().any(|detail| detail.contains("CLOSING:")),
        "{events:?}"
    );
    assert!(
        events.iter().all(|detail| !detail.contains("NARRATION:")),
        "{events:?}"
    );
}

/// A workflow spawned with a `parent_task_id` (the `spawn_workflow` MCP
/// tool's path) reports its finish to that parent's inbox exactly like a
/// plain `spawn_agent` sub-agent — this is what `read_inbox` surfaces back
/// to an orchestrator session.
#[tokio::test]
async fn workflow_spawned_with_a_parent_reports_to_its_inbox() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Closing flow\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "noisy-impl");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();

    // Stand in for an orchestrator-chat task: only its id and inbox matter
    // here, so a session that fails to start is fine.
    let orch_id = daemon
        .create_task(
            "demo",
            "orchestrate",
            "no-such-agent",
            vec!["orchestrator-chat".into()],
            false,
            false,
            None,
            vec![],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::CreateWorkflowTask {
            project: "demo".into(),
            prompt: "do the thing".into(),
            agent: lead,
            tags: vec![],
            worktree: false,
            workflow: "test".into(),
            attachments: vec![],
            default_model: None,
            include_runtime_context: false,
            config_overrides: std::collections::HashMap::new(),
            parent_task_id: Some(orch_id.clone()),
            reply: tx,
        })
        .await;
    let parent_id = rx.await.unwrap().expect("workflow task created");

    wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;

    let inbox = daemon.read_inbox(&orch_id).await;
    assert_eq!(
        inbox.len(),
        1,
        "the finished pipeline should be in the inbox"
    );
    let result = &inbox[0];
    assert_eq!(result.child_id, parent_id);
    assert!(result.success);
    assert!(
        result.output.contains("Workflow **Closing flow** finished"),
        "{}",
        result.output
    );

    // Draining is one-shot, same as for a plain sub-agent.
    assert!(daemon.read_inbox(&orch_id).await.is_empty());
}

/// Archiving an orchestrator must stop a still-running workflow pipeline
/// spawned under it, not just flip its status to Done. Before this was
/// fixed, the direct-child cascade in `ArchiveTask` bypassed
/// `workflow_finalize`, leaving the pipeline's `workflow_runs` entry and
/// its stage session alive — the "archived" task would later flip back
/// out of Done when that stage's turn ended.
#[tokio::test]
async fn archiving_the_orchestrator_stops_a_running_child_workflow() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Q flow\nplan: {{}}\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    // The plan stage asks a question and stalls there, mid-pipeline, with
    // a live (Idle) agent session — exactly the state that must not be
    // left running behind an "archived" task.
    let lead = wf_agent(&dir, "lead.state", "question plan impl");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();

    let orch_id = daemon
        .create_task(
            "demo",
            "orchestrate",
            "no-such-agent",
            vec!["orchestrator-chat".into()],
            false,
            false,
            None,
            vec![],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::CreateWorkflowTask {
            project: "demo".into(),
            prompt: "do the thing".into(),
            agent: lead,
            tags: vec![],
            worktree: false,
            workflow: "test".into(),
            attachments: vec![],
            default_model: None,
            include_runtime_context: false,
            config_overrides: std::collections::HashMap::new(),
            parent_task_id: Some(orch_id.clone()),
            reply: tx,
        })
        .await;
    let parent_id = rx.await.unwrap().expect("workflow task created");

    wait_for_parent(&mut events, &parent_id, "question", |t| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Question)
    })
    .await;

    daemon
        .send(Command::ArchiveTask {
            id: orch_id.clone(),
        })
        .await;

    // Answering the stalled question must now fail: the pipeline was
    // stopped by the archive, not left waiting. `ArchiveTask` has no
    // reply, but the actor processes commands in order, so this
    // reply-awaiting command only completes once the archive has too.
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowReply {
            task: parent_id.clone(),
            message: "Postgres".into(),
            reply: reply_tx,
        })
        .await;
    assert!(
        reply_rx.await.unwrap().is_err(),
        "an archived pipeline must not still accept an answer"
    );

    let workflow_task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == parent_id)
        .expect("workflow parent still exists");
    assert_eq!(workflow_task.status, TaskStatus::Done);
}

#[tokio::test]
async fn workflow_fresh_reask_spawns_new_reviewers() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "reject approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!(
            "name: Fresh flow\nreview:\n  max_rounds: 2\n  reask: fresh\n  reviewers:\n    - agent: {reviewer}\n"
        ),
    )
    .unwrap();
    let lead = wf_agent(&dir, "impl.state", "impl fix");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
    let graph = done.orchestration_graph.unwrap();
    assert_eq!(graph.nodes.len(), 4, "{:?}", graph.nodes);
    assert_ne!(
        graph.nodes[1].task_id, graph.nodes[3].task_id,
        "reask: fresh must staff round 2 with a new reviewer session"
    );
}

/// With the default same_session reask, a reviewer whose session died
/// between rounds falls back to a fresh session — whose prompt carries the
/// previous round's findings for verification.
#[tokio::test]
async fn workflow_dead_reviewer_session_falls_back_to_fresh() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    // Round 1: reject, then the process exits. Round 2 (fresh fallback
    // process) pops the next behavior: approve.
    let reviewer = wf_agent(&dir, "rev.state", "reject-die approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!(
            "name: Fallback flow\nreview:\n  max_rounds: 2\n  reviewers:\n    - agent: {reviewer}\n"
        ),
    )
    .unwrap();
    // A slow fix keeps round 2 far enough away for the reviewer process
    // death (~100ms after its verdict) to be observed first.
    let lead = wf_agent(&dir, "impl.state", "impl slow-fix");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(done.status, TaskStatus::Waiting);
    let run = done.workflow_run.unwrap();
    assert_eq!(run.verdict, Some(wire::WorkflowVerdict::Approve));
    let graph = done.orchestration_graph.unwrap();
    assert_eq!(graph.nodes.len(), 4, "{:?}", graph.nodes);
    assert_ne!(
        graph.nodes[1].task_id, graph.nodes[3].task_id,
        "a dead reviewer session must be replaced by a fresh one"
    );
}

/// Losing a stage's agent must not finish the pipeline. It used to call
/// workflow_finalize, which is terminal — the run was over, resume refused
/// with "the pipeline is not paused", and a user whose agent died had to
/// start again from a new task even when the work was already done. The run
/// now parks at the pause barrier, and resuming re-runs the stage.
#[tokio::test]
async fn workflow_lost_stage_agent_pauses_instead_of_failing() {
    use warpforge_protocol as wire;
    let (dir, projects) = workflow_project("name: placeholder\n");
    let reviewer = wf_agent(&dir, "rev.state", "approve");
    std::fs::write(
        dir.path().join(".warpforge/workflows/test.yaml"),
        format!("name: Lost agent\nreview:\n  reviewers:\n    - agent: {reviewer}\n"),
    )
    .unwrap();
    // Implement dies mid-turn; the re-run after resume implements normally.
    let lead = wf_agent(&dir, "impl.state", "die impl");

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let paused = wait_for_parent(&mut events, &parent_id, "paused after lost agent", |t| {
        t.workflow_run
            .as_ref()
            .and_then(|w| w.waiting.as_ref())
            .is_some_and(|w| w.kind == wire::WorkflowWaitKind::Paused)
    })
    .await;
    assert_eq!(paused.status, TaskStatus::Waiting);
    assert_eq!(
        paused.workflow_run.as_ref().unwrap().stage,
        wire::WorkflowStage::Implement,
        "it parks at the stage that lost its agent, ready to re-run it"
    );

    // The run is genuinely resumable — the whole point.
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::WorkflowResume {
            task: parent_id.clone(),
            note: None,
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("a parked run must accept resume");

    let done = wait_for_parent(&mut events, &parent_id, "pipeline done", |t| {
        t.workflow_run
            .as_ref()
            .is_some_and(|w| w.stage == wire::WorkflowStage::Done)
    })
    .await;
    assert_eq!(
        done.workflow_run.unwrap().verdict,
        Some(wire::WorkflowVerdict::Approve),
        "resuming re-runs the stage and the pipeline completes"
    );
}
