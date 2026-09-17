//! Regression tests for prompt serialization: one `session/prompt` per session
//! at a time, with mid-turn prompts queued as follow-up turns.
//!
//! Both fixtures record every prompt arrival. `mock-acp-serial.mjs` ends the
//! running turn early when a second prompt arrives while one is outstanding and
//! logs `overlap` — exactly the adapter behaviour that used to make the actor
//! read a spurious `TurnEnded` as the task finishing. `mock-acp-interrupt.mjs`
//! holds one turn open until it is cancelled, for the force-send tests.

mod force_send;
mod queueing;

use super::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use warpforge_protocol as wire;

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

/// Like [`serial_agent`], but turn 1 holds until `release_turn_one` is called
/// rather than for a fixed time — the window a test needs to act inside cannot
/// then be closed by a loaded machine.
fn gated_serial_agent(dir: &Path) -> (String, PathBuf, PathBuf) {
    let log = dir.join("serial.log");
    let gate = dir.join("release-turn-1");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-serial.mjs"
    );
    (
        format!("node {fixture} {} 0 {}", log.display(), gate.display()),
        log,
        gate,
    )
}

fn release_turn_one(gate: &Path) {
    std::fs::write(gate, "go").expect("gate file written");
}

/// `hold_turn` is the turn that waits for a cancel instead of answering;
/// `ignore_cancels` is how many cancels the agent works straight through.
fn interrupt_agent(dir: &Path, hold_turn: u32, ignore_cancels: u32) -> (String, PathBuf) {
    let log = dir.join("interrupt.log");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-interrupt.mjs"
    );
    (
        format!(
            "node {fixture} {} {hold_turn} {ignore_cancels}",
            log.display()
        ),
        log,
    )
}

fn read_log(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Record every status the daemon publishes, with consecutive repeats
/// collapsed — the transitions are what the test is about, not the re-emits.
fn record_statuses(daemon: &DaemonHandle) -> Arc<Mutex<Vec<(String, String)>>> {
    let trail = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&trail);
    let mut events = daemon.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            if let Event::TaskUpdated(task) = event {
                let entry = (task.id.clone(), task.status.to_string());
                let mut sink = sink.lock().unwrap();
                if sink.last() != Some(&entry) {
                    sink.push(entry);
                }
            }
        }
    });
    trail
}

fn statuses_of(trail: &Arc<Mutex<Vec<(String, String)>>>, task_id: &str) -> Vec<String> {
    trail
        .lock()
        .unwrap()
        .iter()
        .filter(|(id, _)| id == task_id)
        .map(|(_, status)| status.clone())
        .fold(Vec::new(), |mut acc, status| {
            if acc.last() != Some(&status) {
                acc.push(status);
            }
            acc
        })
}

/// Record every task's conversation in order: agent text as it streams, a
/// recorded user message as `user:<text>`.
fn record_text(daemon: &DaemonHandle) -> Arc<Mutex<Vec<(String, String)>>> {
    let trail = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&trail);
    let mut events = daemon.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            let Event::SessionUpdate { task_id, update } = event else {
                continue;
            };
            let entry = match update {
                wire::SessionUpdate::AgentText { text } => text,
                wire::SessionUpdate::UserMessage { text, .. } => format!("user:{text}"),
                _ => continue,
            };
            sink.lock().unwrap().push((task_id, entry));
        }
    });
    trail
}

fn text_of(trail: &Arc<Mutex<Vec<(String, String)>>>, task_id: &str) -> Vec<String> {
    trail
        .lock()
        .unwrap()
        .iter()
        .filter(|(id, _)| id == task_id)
        .map(|(_, entry)| entry.clone())
        .collect()
}

/// The text of every message still waiting for the agent, in order.
async fn queued_texts(daemon: &DaemonHandle, task_id: &str) -> Vec<String> {
    daemon
        .tasks()
        .await
        .iter()
        .find(|t| t.id == task_id)
        .map(|t| {
            t.queued_prompts
                .iter()
                .map(|queued| queued.text.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// For a message whose text is not worth spelling out in the test (an
/// automation's marked prompt).
async fn wait_for_queue_len(daemon: &DaemonHandle, task_id: &str, len: usize) {
    timeout(Duration::from_secs(5), async {
        loop {
            if queued_texts(daemon, task_id).await.len() == len {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("the queue never held {len} messages"));
}

async fn wait_for_queue(daemon: &DaemonHandle, task_id: &str, texts: &[&str]) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    timeout(Duration::from_secs(5), async {
        loop {
            let waiting = queued_texts(daemon, task_id).await;
            if waiting == texts {
                break;
            }
            *sink.lock().unwrap() = waiting;
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "the queue never held {texts:?}; last saw {:?}",
            seen.lock().unwrap()
        )
    });
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
