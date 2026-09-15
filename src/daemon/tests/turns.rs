//! Regression tests for prompt serialization: one `session/prompt` per session
//! at a time, with mid-turn prompts queued as follow-up turns.
//!
//! The fixture (`tests/fixtures/mock-acp-serial.mjs`) records every prompt
//! arrival. A second prompt while one is outstanding makes it end the running
//! turn early and log `overlap` — exactly the adapter behaviour that used to
//! make the actor read a spurious `TurnEnded` as the task finishing.

use super::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn serial_agent(dir: &Path, first_turn_hold_ms: u64) -> (String, PathBuf) {
    let log = dir.join("serial.log");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-serial.mjs"
    );
    (
        format!("node {fixture} {} {first_turn_hold_ms}", log.display()),
        log,
    )
}

fn read_log(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

async fn wait_for_line(path: &Path, needle: &str) {
    timeout(Duration::from_secs(5), async {
        loop {
            if read_log(path).contains(needle) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("mock log never contained {needle:?}"));
}

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
