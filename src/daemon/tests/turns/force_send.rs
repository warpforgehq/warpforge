//! "Send all now": the running turn is cut short and what was waiting goes out
//! at once.

use super::*;

/// An automation that prompts into `task_id`'s own session, disabled so only
/// an explicit run-now fires it.
async fn reuse_automation(daemon: &DaemonHandle, task_id: &str, prompt: &str) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::AutomationCreate {
            automation: Box::new(wire::Automation {
                id: "automation-1".into(),
                project: "demo".into(),
                name: "nightly".into(),
                prompt: prompt.into(),
                agent: "unused".into(),
                model: None,
                config_overrides: HashMap::new(),
                trigger: wire::AutomationTrigger::default(),
                timezone: "UTC".into(),
                precheck: None,
                enabled: false,
                missed_run_grace_minutes: 0,
                reuse_session: true,
                worktree: false,
                created_at: 0,
                updated_at: 0,
                next_run_at: None,
                last_run_at: None,
                last_status: None,
                last_task_id: Some(task_id.into()),
            }),
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("automation created").id
}

async fn run_now(daemon: &DaemonHandle, automation_id: &str) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::AutomationRunNow {
            id: automation_id.into(),
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("run dispatched");
}

fn record_run_statuses(daemon: &DaemonHandle) -> Arc<Mutex<Vec<String>>> {
    let trail = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&trail);
    let mut events = daemon.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            if let Event::AutomationRunUpdated(run) = event {
                sink.lock().unwrap().push(run.status.as_str().to_string());
            }
        }
    });
    trail
}

async fn wait_for_run_status(trail: &Arc<Mutex<Vec<String>>>, status: &str) {
    timeout(Duration::from_secs(5), async {
        loop {
            if trail.lock().unwrap().iter().any(|s| s == status) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "the run never reached {status}: {:?}",
            trail.lock().unwrap()
        )
    });
}

/// "Send all now" with nothing waiting is refused, not obeyed. The click lost
/// a race with the queue draining, and cutting the turn short would kill the
/// very message it was meant to hurry along.
#[tokio::test]
async fn force_send_with_an_empty_queue_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 0);
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
    let refusal = daemon
        .session_interrupt(&task)
        .await
        .expect_err("an empty queue has nothing to force through");
    assert!(
        refusal.contains("nothing is waiting"),
        "the refusal should say why: {refusal}"
    );

    tokio::time::sleep(Duration::from_millis(150)).await;
    let log_text = read_log(&log);
    assert!(
        !log_text.contains("cancel"),
        "a refused force-send must not cancel the running turn:\n{log_text}"
    );
    let tasks = daemon.tasks().await;
    let task = tasks.iter().find(|t| t.id == task).expect("task exists");
    assert_eq!(
        task.status,
        TaskStatus::Running,
        "the turn is still running"
    );
    daemon.shutdown().await;
}

/// Force-send: the running turn is cut short and everything waiting behind it
/// goes out as one turn, in order. The cut-short turn is not a completed turn —
/// its half-written answer must never reach the parent's inbox as a result.
#[tokio::test]
async fn force_send_interrupts_the_running_turn_without_flushing_it() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());

    let trail = record_statuses(&daemon);
    let parent = "orch-task";
    let child = daemon
        .create_task(
            "demo",
            "PROMPT_A",
            &agent,
            vec![],
            false,
            false,
            Some(parent.into()),
            vec![],
            None,
            HashMap::new(),
            None,
        )
        .await;

    // Turn 1 streams a fragment and then holds: only a cancel ends it.
    wait_for_line(&log, "turn1:start").await;
    daemon
        .session_prompt(&child, "PROMPT_B", vec![])
        .await
        .unwrap();
    daemon
        .session_prompt(&child, "PROMPT_C", vec![])
        .await
        .unwrap();
    wait_for_queue(&daemon, &child, &["PROMPT_B", "PROMPT_C"]).await;
    daemon.session_interrupt(&child).await.unwrap();

    wait_for_line(&log, "turn2:end").await;
    wait_for_queue(&daemon, &child, &[]).await;
    let inbox = timeout(Duration::from_secs(5), async {
        loop {
            let collected = daemon.read_inbox(parent).await;
            if !collected.is_empty() {
                break collected;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the merged turn should deliver a result");

    assert_eq!(
        inbox.len(),
        1,
        "only the turn that finished on its own is a result"
    );
    assert!(
        inbox[0].output.contains("DONE_PROMPT_B+PROMPT_C"),
        "the result must answer the whole batch: {}",
        inbox[0].output
    );
    // The promise of the whole feature: the turn that was cut short did stream
    // text, and none of it may be filed as the batch's answer.
    assert!(
        !inbox[0].output.contains("HALF_FINISHED_THOUGHT"),
        "the interrupted turn's fragment leaked into the batch's result: {}",
        inbox[0].output
    );
    // Nothing else lands afterwards either — the interrupted turn stays silent.
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        daemon.read_inbox(parent).await.is_empty(),
        "an interrupted turn must not flush its partial text as a result"
    );

    let log_text = read_log(&log);
    assert!(
        !log_text.contains("overlap"),
        "the batch must wait for the cancel, not race it:\n{log_text}"
    );
    let order: Vec<&str> = log_text.lines().collect();
    assert_eq!(
        order,
        vec![
            "prompt:PROMPT_A",
            "turn1:start",
            "cancel",
            "turn1:cancelled",
            "prompt:PROMPT_B+PROMPT_C",
            "turn2:start",
            "turn2:end",
        ],
        "force-send cancels, then sends the whole queue as one prompt in order"
    );
    assert_eq!(
        order
            .iter()
            .filter(|line| line.starts_with("prompt:"))
            .count(),
        2,
        "the batch is one prompt, not one per queued message:\n{log_text}"
    );

    timeout(Duration::from_secs(5), async {
        loop {
            if statuses_of(&trail, &child).len() >= 4 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the merged turn should run and then yield");
    assert_eq!(
        statuses_of(&trail, &child),
        vec!["running", "waiting", "running", "waiting"],
        "the interrupted turn yields honestly, then the batch owns a turn"
    );
    daemon.shutdown().await;
}

/// Only the user's own messages are batched. A scheduled run's prompt waiting
/// in the same queue keeps its own turn — folding it into the batch would file
/// its answer as the user's, and would fail the run on the user's interrupted
/// turn, one the run never started.
#[tokio::test]
async fn a_force_send_batches_only_the_users_own_messages() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 2, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let runs = record_run_statuses(&daemon);
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

    // Turn 2 is the one that holds, so the user's own turn is what the
    // force-send cuts short.
    wait_for_line(&log, "turn1:end").await;
    daemon
        .session_prompt(&task, "PROMPT_B", vec![])
        .await
        .unwrap();
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
    wait_for_line(&log, "turn4:end").await;

    let log_text = read_log(&log);
    let order: Vec<&str> = log_text.lines().collect();
    assert_eq!(
        order,
        vec![
            "prompt:PROMPT_A",
            "turn1:start",
            "turn1:end",
            "prompt:PROMPT_B",
            "turn2:start",
            "cancel",
            "turn2:cancelled",
            "prompt:PROMPT_D",
            "turn3:start",
            "turn3:end",
            "prompt:PROMPT_C",
            "turn4:start",
            "turn4:end",
        ],
        "the batch is the user's message alone; the run's prompt follows as its own turn"
    );

    wait_for_run_status(&runs, "completed").await;
    assert!(
        !runs.lock().unwrap().iter().any(|s| s == "failed"),
        "the user's interrupted turn is not the run's: {:?}",
        runs.lock().unwrap()
    );
    daemon.shutdown().await;
}

/// The agent ignored the first cancel, so the user forces a second message
/// through while the first batch is still waiting. The second force-send adds
/// to that batch — replacing it would drop the message that was already in it.
#[tokio::test]
async fn a_second_force_send_adds_to_the_waiting_batch() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 1);
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
    daemon
        .session_prompt(&task, "PROMPT_B", vec![])
        .await
        .unwrap();
    wait_for_queue(&daemon, &task, &["PROMPT_B"]).await;
    daemon.session_interrupt(&task).await.unwrap();

    // The first cancel was swallowed, so turn 1 is still running — and the
    // batched message is still shown as waiting, because it is.
    wait_for_line(&log, "cancel").await;
    daemon
        .session_prompt(&task, "PROMPT_C", vec![])
        .await
        .unwrap();
    wait_for_queue(&daemon, &task, &["PROMPT_B", "PROMPT_C"]).await;
    daemon.session_interrupt(&task).await.unwrap();

    wait_for_line(&log, "turn2:end").await;
    let log_text = read_log(&log);
    let order: Vec<&str> = log_text.lines().collect();
    assert_eq!(
        order,
        vec![
            "prompt:PROMPT_A",
            "turn1:start",
            "cancel",
            "cancel",
            "turn1:cancelled",
            "prompt:PROMPT_B+PROMPT_C",
            "turn2:start",
            "turn2:end",
        ],
        "the second force-send must carry the first one's message too"
    );
    daemon.shutdown().await;
}

/// The batch enters the conversation the way the agent received it: one message
/// carrying the merged text, written when it is sent. The alternative — one
/// bubble per queued message — reads more naturally but shows an input the
/// agent was never given (see `docs/adr/0011`).
#[tokio::test]
async fn a_force_sent_batch_is_recorded_as_the_one_message_the_agent_got() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = interrupt_agent(dir.path(), 1, 0);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let streamed = record_text(&daemon);
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
    daemon
        .session_prompt(&task, "PROMPT_B", vec![])
        .await
        .unwrap();
    daemon
        .session_prompt(&task, "PROMPT_C", vec![])
        .await
        .unwrap();
    wait_for_queue(&daemon, &task, &["PROMPT_B", "PROMPT_C"]).await;
    daemon.session_interrupt(&task).await.unwrap();
    wait_for_line(&log, "turn2:end").await;
    wait_for_queue(&daemon, &task, &[]).await;

    timeout(Duration::from_secs(5), async {
        loop {
            if text_of(&streamed, &task).len() >= 4 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the batch's turn should answer");
    assert_eq!(
        text_of(&streamed, &task),
        vec![
            "user:PROMPT_A",
            "HALF_FINISHED_THOUGHT",
            "user:PROMPT_B\n\nPROMPT_C",
            "DONE_PROMPT_B+PROMPT_C",
        ],
        "the two queued messages are one message in the transcript, written when they went out"
    );
    daemon.shutdown().await;
}
