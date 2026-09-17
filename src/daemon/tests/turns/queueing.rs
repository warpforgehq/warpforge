//! A prompt sent while a turn is running waits its place in line.

use super::*;

/// Writing into a running child queues a follow-up turn. It must not deliver a
/// partial result to the parent inbox, mark the child Waiting, or overlap two
/// `session/prompt`s — that flap is the bug.
#[tokio::test]
async fn a_followup_to_a_running_child_queues_without_flapping_it() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = serial_agent(dir.path(), 300);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());

    // The parent only needs an id; it owns the inbox and never runs a session.
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

    wait_for_line(&log, "turn1:start").await;

    // A follow-up while the child is mid-turn.
    daemon
        .session_prompt(&child, "PROMPT_B", vec![])
        .await
        .unwrap();

    // Give the old fire-and-forget path time to deliver it concurrently. It
    // would end turn 1 early, which the actor reads as the task finishing.
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert!(
        daemon.read_inbox(parent).await.is_empty(),
        "a mid-turn follow-up must not flush the child's output into the parent inbox"
    );
    let tasks = daemon.tasks().await;
    let task = tasks.iter().find(|t| t.id == child).expect("child exists");
    assert_eq!(
        task.status,
        TaskStatus::Running,
        "the child must not flap to Waiting while its turn is still running"
    );

    wait_for_line(&log, "turn2:end").await;

    // Two real turns, one inbox result each. `read_inbox` drains, so collect
    // across reads rather than expecting both results in a single read.
    let inbox = timeout(Duration::from_secs(5), async {
        let mut collected = Vec::new();
        loop {
            collected.extend(daemon.read_inbox(parent).await);
            if collected.len() >= 2 {
                break collected;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("one result per real turn should land in the parent inbox");
    assert_eq!(inbox.len(), 2, "exactly one result per real turn");

    let log_text = read_log(&log);
    assert!(
        !log_text.contains("overlap"),
        "at most one session/prompt may be outstanding at a time:\n{log_text}"
    );
    daemon.shutdown().await;
}

/// A message sent to a busy agent waits out of sight: it is in the queue, with
/// its text, and nowhere in the transcript until the agent is handed it. The
/// running turn's own result stays whole across that submit.
#[tokio::test]
async fn a_queued_message_stays_out_of_the_transcript_until_it_is_dispatched() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log, gate) = gated_serial_agent(dir.path());
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let streamed = record_text(&daemon);

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

    // Turn 1 streams BEFORE_PROMPT_A and then holds until the gate opens.
    wait_for_line(&log, "turn1:start").await;
    daemon
        .session_prompt(&child, "PROMPT_B", vec![])
        .await
        .unwrap();
    wait_for_queue(&daemon, &child, &["PROMPT_B"]).await;

    assert!(
        !text_of(&streamed, &child)
            .iter()
            .any(|e| e == "user:PROMPT_B"),
        "a waiting message is not in the conversation: {:?}",
        text_of(&streamed, &child)
    );

    // Turn 1 finishes and turn 2 takes the queued message.
    release_turn_one(&gate);
    wait_for_line(&log, "turn2:start").await;
    timeout(Duration::from_secs(5), async {
        loop {
            if text_of(&streamed, &child)
                .iter()
                .any(|e| e == "user:PROMPT_B")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the message enters the conversation when the agent is handed it");
    assert_eq!(
        queued_texts(&daemon, &child).await,
        Vec::<String>::new(),
        "and it stops being a waiting message at the same moment"
    );

    let stream = text_of(&streamed, &child);
    let echo = stream.iter().position(|e| e == "user:PROMPT_B").unwrap();
    let after = stream
        .iter()
        .position(|e| e == "AFTER_PROMPT_A")
        .expect("turn 1 streamed after the hold");
    assert!(
        after < echo,
        "the echo belongs to the turn that carried it, not the one it waited on: {stream:?}"
    );

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
    .expect("the first turn should deliver a result");
    assert!(
        inbox[0].output.contains("BEFORE_PROMPT_A") && inbox[0].output.contains("AFTER_PROMPT_A"),
        "the turn's result is the whole turn, not just what came after the queued message: {}",
        inbox[0].output
    );
    daemon.shutdown().await;
}

/// The queue is the list itself, in order, with the text of each message.
#[tokio::test]
async fn the_queue_reports_every_waiting_message_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log, gate) = gated_serial_agent(dir.path());
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
    for text in ["PROMPT_B", "PROMPT_C", "PROMPT_D"] {
        daemon.session_prompt(&task, text, vec![]).await.unwrap();
    }
    wait_for_queue(&daemon, &task, &["PROMPT_B", "PROMPT_C", "PROMPT_D"]).await;

    // Each one leaves the list as its own turn takes it.
    release_turn_one(&gate);
    wait_for_queue(&daemon, &task, &["PROMPT_C", "PROMPT_D"]).await;
    wait_for_queue(&daemon, &task, &["PROMPT_D"]).await;
    wait_for_queue(&daemon, &task, &[]).await;
    daemon.shutdown().await;
}

/// Follow-ups sent back to back are dispatched after the running turn
/// completes, in the order they were sent.
#[tokio::test]
async fn queued_prompts_are_dispatched_in_order_after_the_running_turn() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = serial_agent(dir.path(), 300);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let child = daemon
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
        .session_prompt(&child, "PROMPT_B", vec![])
        .await
        .unwrap();
    daemon
        .session_prompt(&child, "PROMPT_C", vec![])
        .await
        .unwrap();

    wait_for_line(&log, "turn3:end").await;
    let log_text = read_log(&log);
    let sequence: Vec<&str> = log_text.lines().collect();
    assert_eq!(
        sequence,
        vec![
            "prompt:PROMPT_A",
            "turn1:start",
            "turn1:end",
            "prompt:PROMPT_B",
            "turn2:start",
            "turn2:end",
            "prompt:PROMPT_C",
            "turn3:start",
            "turn3:end",
        ],
        "prompts must be serialized and dispatched in order"
    );
    daemon.shutdown().await;
}

/// A message sent mid-turn waits, and the task says so: it is only Running
/// again once that message actually goes out, and Waiting again when its own
/// turn ends. Reporting Running the moment the user hits send is the lie this
/// pins down — the agent has not seen the message yet.
#[tokio::test]
async fn a_queued_message_runs_its_own_turn_and_then_waits() {
    let dir = tempfile::tempdir().unwrap();
    let (agent, log) = serial_agent(dir.path(), 300);
    let daemon = Daemon::spawn(test_projects(), Store::open_at(Path::new(":memory:")).ok());
    let trail = record_statuses(&daemon);
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

    wait_for_line(&log, "turn2:end").await;
    wait_for_queue(&daemon, &task, &[]).await;
    timeout(Duration::from_secs(5), async {
        loop {
            if statuses_of(&trail, &task).len() >= 4 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the queued turn should run and then yield");

    assert_eq!(
        statuses_of(&trail, &task),
        vec!["running", "waiting", "running", "waiting"],
        "the queued message must own a turn of its own"
    );
    daemon.shutdown().await;
}
