//! A peer's message is its own turn (ADR 0026 invariants 4 and 5): never
//! folded into the user's force-sent batch, and never the answer that closes
//! or fails a scheduled run.

use super::*;

async fn prompt_as(
    daemon: &DaemonHandle,
    task_id: &str,
    text: &str,
    initiator: crate::daemon::acp::TurnInitiator,
) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::SessionPrompt {
            task_id: task_id.into(),
            text: text.into(),
            attachments: Vec::new(),
            initiator,
            peer_message: None,
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("prompt accepted");
}

async fn peer_prompt(daemon: &DaemonHandle, task_id: &str, text: &str) {
    prompt_as(
        daemon,
        task_id,
        text,
        crate::daemon::acp::TurnInitiator::Peer,
    )
    .await;
}

/// `(status, output)` of every run update.
type RunTrail = Arc<Mutex<Vec<(String, Option<String>)>>>;

fn record_run_outputs(daemon: &DaemonHandle) -> RunTrail {
    let trail = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&trail);
    let mut events = daemon.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            if let Event::AutomationRunUpdated(run) = event {
                sink.lock()
                    .unwrap()
                    .push((run.status.as_str().to_string(), run.output.clone()));
            }
        }
    });
    trail
}

async fn start(daemon: &DaemonHandle, agent: &str) -> String {
    daemon
        .create_task(
            "demo",
            "PROMPT_A",
            agent,
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            HashMap::new(),
            None,
        )
        .await
}

/// The queue holds a peer's message and a run's prompt; the user force-sends
/// their own. The peer's turn ends before the run's, and must not close it.
#[tokio::test]
async fn a_peer_prompt_is_not_batched_and_its_turn_does_not_close_a_run() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 2, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let runs = record_run_outputs(&daemon);
    let task = start(&daemon, &agent).await;
    wait_for_line(&log, "turn1:end").await;
    daemon
        .session_prompt(&task, "PROMPT_B", vec![])
        .await
        .unwrap();
    wait_for_line(&log, "turn2:start").await;

    peer_prompt(&daemon, &task, "a peer asks").await;
    wait_for_queue_len(&daemon, &task, 1).await;
    let automation = reuse_automation(&daemon, &task, "PROMPT_C").await;
    run_now(&daemon, &automation).await;
    wait_for_queue_len(&daemon, &task, 2).await;
    daemon
        .session_prompt(&task, "PROMPT_D", vec![])
        .await
        .unwrap();
    wait_for_queue_len(&daemon, &task, 3).await;

    daemon.session_interrupt(&task).await.unwrap();
    wait_for_line(&log, "turn5:end").await;
    let log_text = read_log(&log);
    let prompts: Vec<&str> = log_text
        .lines()
        .filter(|line| line.starts_with("prompt:"))
        .collect();
    assert_eq!(
        prompts,
        vec![
            "prompt:PROMPT_A",
            "prompt:PROMPT_B",
            "prompt:PROMPT_D",
            "prompt:unknown",
            "prompt:PROMPT_C",
        ],
        "the batch is the user's alone; the peer and the run keep their turns"
    );

    timeout(Duration::from_secs(5), async {
        while !runs.lock().unwrap().iter().any(|(s, _)| s == "completed") {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the run completes");
    let output = runs
        .lock()
        .unwrap()
        .iter()
        .find(|(s, _)| s == "completed")
        .and_then(|(_, output)| output.clone())
        .unwrap_or_default();
    assert!(
        output.contains("DONE_PROMPT_C"),
        "closed by its own turn: {output}"
    );
    assert!(
        !output.contains("DONE_unknown"),
        "not by the peer's: {output}"
    );
    daemon.shutdown().await;
}

/// A peer's turn cut short by a force-send is not the run's turn to fail.
#[tokio::test]
async fn an_interrupted_peer_turn_does_not_fail_a_run() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 2, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let runs = record_run_statuses(&daemon);
    let task = start(&daemon, &agent).await;
    wait_for_line(&log, "turn1:end").await;
    peer_prompt(&daemon, &task, "a peer asks").await;
    wait_for_line(&log, "turn2:start").await;

    let automation = reuse_automation(&daemon, &task, "PROMPT_C").await;
    run_now(&daemon, &automation).await;
    wait_for_queue_len(&daemon, &task, 1).await;
    daemon
        .session_prompt(&task, "PROMPT_D", vec![])
        .await
        .unwrap();
    wait_for_queue_len(&daemon, &task, 2).await;
    daemon.session_interrupt(&task).await.unwrap();

    wait_for_line(&log, "turn2:cancelled").await;
    wait_for_run_status(&runs, "completed").await;
    assert!(
        !runs.lock().unwrap().iter().any(|s| s == "failed"),
        "the peer's interrupted turn is not the run's: {:?}",
        runs.lock().unwrap()
    );
    daemon.shutdown().await;
}

/// A force-send with no message of the user's waiting cuts nothing short.
async fn force_send_refused_with_only(initiator: crate::daemon::acp::TurnInitiator) {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let task = start(&daemon, &agent).await;
    wait_for_line(&log, "turn1:start").await;
    prompt_as(&daemon, &task, "not the user's", initiator).await;
    wait_for_queue_len(&daemon, &task, 1).await;

    assert!(daemon.session_interrupt(&task).await.is_err());
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!read_log(&log).contains("cancel"), "the turn runs on");
    daemon.shutdown().await;
}

#[tokio::test]
async fn force_send_with_only_a_peer_message_waiting_is_refused() {
    force_send_refused_with_only(crate::daemon::acp::TurnInitiator::Peer).await;
}

#[tokio::test]
async fn force_send_with_only_a_system_message_waiting_is_refused() {
    force_send_refused_with_only(crate::daemon::acp::TurnInitiator::System).await;
}

/// A peer's queued text is what the feed and the sender recorded.
#[tokio::test]
async fn a_queued_peer_message_cannot_be_edited() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let task = start(&daemon, &agent).await;
    wait_for_line(&log, "turn1:start").await;
    peer_prompt(&daemon, &task, "a peer asks").await;
    wait_for_queue_len(&daemon, &task, 1).await;
    let queued = queued_entries(&daemon, &task).await;
    let error = daemon
        .session_edit_queued(&task, &queued[0].id, "rewritten")
        .await
        .unwrap_err();
    assert!(error.contains("only your own messages"), "{error}");
    assert_eq!(queued_texts(&daemon, &task).await, vec!["a peer asks"]);
    daemon.shutdown().await;
}
