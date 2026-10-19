//! Delivery on real sessions (ADR 0026 invariants 2, 3 and 6): the record
//! first, the turn later, and nothing marked delivered before it starts.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::*;

const PEER_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-peer.mjs"
);
const RECOVERY_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-recovery.mjs"
);

struct Agent {
    command: String,
    log: PathBuf,
    gate: PathBuf,
}

fn peer_agent(dir: &tempfile::TempDir, gated: bool) -> Agent {
    let log = dir.path().join("prompts.log");
    let gate = dir.path().join("gate");
    let command = if gated {
        format!("node {PEER_FIXTURE} {} {}", log.display(), gate.display())
    } else {
        format!("node {PEER_FIXTURE} {}", log.display())
    };
    Agent { command, log, gate }
}

fn lines(log: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn prompt_texts(log: &Path) -> Vec<String> {
    lines(log)
        .iter()
        .filter_map(|line| line["text"].as_str().map(str::to_string))
        .collect()
}

async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    timeout(Duration::from_secs(10), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for: {what}"));
}

async fn start(daemon: &DaemonHandle, agent: &Agent) -> String {
    let id = daemon
        .create_task(
            "demo",
            "receiver work",
            &agent.command,
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
    let log = agent.log.clone();
    eventually("the first prompt", || !prompt_texts(&log).is_empty()).await;
    id
}

async fn record(daemon: &DaemonHandle, id: u64) -> wire::PeerMessage {
    feed(daemon)
        .await
        .into_iter()
        .find(|r| r.id == id)
        .expect("the record is in the feed")
}

async fn wait_for_status(daemon: &DaemonHandle, id: u64, status: wire::PeerMessageStatus) {
    timeout(Duration::from_secs(10), async {
        while record(daemon, id).await.status != status {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("record {id} never became {status:?}"));
}

/// Until the daemon has processed the task's turn end with nothing queued:
/// the agent's own log says the turn ended before the actor knows it.
async fn wait_idle(daemon: &DaemonHandle, task_id: &str) {
    timeout(Duration::from_secs(10), async {
        loop {
            let idle = daemon.tasks().await.iter().any(|t| {
                t.id == task_id && t.status == TaskStatus::Waiting && t.queued_prompts.is_empty()
            });
            if idle {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the task goes idle");
}

/// The receiver's waiting messages, once there are any.
async fn queued_prompts(daemon: &DaemonHandle, task_id: &str) -> Vec<wire::QueuedPrompt> {
    timeout(Duration::from_secs(10), async {
        loop {
            let tasks = daemon.tasks().await;
            let queued = tasks
                .iter()
                .find(|t| t.id == task_id)
                .map(|t| t.queued_prompts.clone())
                .unwrap_or_default();
            if !queued.is_empty() {
                break queued;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("a message waits in the queue")
}

type Trail = Arc<Mutex<Vec<(String, wire::SessionUpdate)>>>;

/// Every peer chat entry and every record event, in the order they went out.
fn record_peer_events(daemon: &DaemonHandle) -> (Trail, Arc<Mutex<Vec<wire::PeerMessage>>>) {
    let entries: Trail = Default::default();
    let records: Arc<Mutex<Vec<wire::PeerMessage>>> = Default::default();
    let (entry_sink, record_sink) = (Arc::clone(&entries), Arc::clone(&records));
    let mut events = daemon.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            match event {
                Event::SessionUpdate { task_id, update } => {
                    if matches!(update, wire::SessionUpdate::PeerMessage { .. }) {
                        entry_sink.lock().unwrap().push((task_id, update));
                    }
                }
                Event::PeerMessageUpdated(record) => record_sink.lock().unwrap().push(*record),
                _ => {}
            }
        }
    });
    (entries, records)
}

fn directions(trail: &Trail, task_id: &str) -> Vec<wire::PeerDirection> {
    trail
        .lock()
        .unwrap()
        .iter()
        .filter(|(id, _)| id == task_id)
        .filter_map(|(_, update)| match update {
            wire::SessionUpdate::PeerMessage { direction, .. } => Some(*direction),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_direct_message_is_recorded_first_and_delivered_when_its_turn_starts() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, true);
    let daemon = seeded(memory_store());
    let (entries, records) = record_peer_events(&daemon);
    let receiver = start(&daemon, &agent).await;

    let sent = send(&daemon, "t_a", &receiver, "can you look at auth?")
        .await
        .unwrap();
    let id = sent.message.unwrap().id;
    let queued = queued_prompts(&daemon, &receiver).await;
    assert_eq!(queued[0].initiator, "peer");
    assert_eq!(queued[0].peer_message_id, Some(id));
    eventually("the sender's entry", || {
        directions(&entries, "t_a") == vec![wire::PeerDirection::Sent]
    })
    .await;
    assert_eq!(
        records.lock().unwrap()[0].status,
        wire::PeerMessageStatus::Queued
    );
    assert!(
        directions(&entries, &receiver).is_empty(),
        "nothing is said before the turn"
    );
    assert_eq!(record(&daemon, id).await.delivered_at, None);

    std::fs::write(&agent.gate, "go").unwrap();
    wait_for_status(&daemon, id, wire::PeerMessageStatus::Delivered).await;
    let log = agent.log.clone();
    eventually("the agent gets the message", || {
        prompt_texts(&log).len() == 2
    })
    .await;
    let texts = prompt_texts(&agent.log);
    let delivered = &texts[1];
    assert!(delivered.contains("<peer_messages>"), "{delivered}");
    assert!(delivered.contains("<peer_message from=\"work of t_a\" task=\"t_a\" kind=\"direct\">"));
    assert!(delivered.contains("can you look at auth?"));
    assert!(record(&daemon, id).await.delivered_at.is_some());
    eventually("the receiver's entry", || {
        directions(&entries, &receiver) == vec![wire::PeerDirection::Received]
    })
    .await;

    let again = send(&daemon, "t_a", &receiver, "thanks").await.unwrap_err();
    assert!(
        again.contains("seconds to the same peer"),
        "the slot is free: {again}"
    );
}

#[tokio::test]
async fn a_team_post_starts_no_turn_and_rides_the_next_prompt_once() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, false);
    let daemon = seeded(memory_store());
    let (entries, _) = record_peer_events(&daemon);
    let receiver = start(&daemon, &agent).await;
    wait_idle(&daemon, &receiver).await;
    let log = agent.log.clone();

    send(&daemon, "t_a", "team", "main is red").await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(prompt_texts(&agent.log).len(), 1, "a post wakes nobody");

    daemon
        .session_prompt(&receiver, "next", vec![])
        .await
        .unwrap();
    eventually("the second prompt", || prompt_texts(&log).len() == 2).await;
    let second = &prompt_texts(&agent.log)[1];
    assert!(
        second.contains("<peer_message from=\"work of t_a\" task=\"t_a\" kind=\"team\">"),
        "{second}"
    );
    assert!(second.contains("main is red"));
    eventually("the digest entry", || {
        directions(&entries, &receiver) == vec![wire::PeerDirection::Digest]
    })
    .await;

    wait_idle(&daemon, &receiver).await;
    daemon
        .session_prompt(&receiver, "again", vec![])
        .await
        .unwrap();
    eventually("the third prompt", || prompt_texts(&log).len() == 3).await;
    assert!(
        !prompt_texts(&agent.log)[2].contains("main is red"),
        "seen once"
    );
}

#[tokio::test]
async fn a_digest_whose_prompt_never_started_is_given_again() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, true);
    let daemon = seeded(memory_store());
    let receiver = start(&daemon, &agent).await;

    send(&daemon, "t_a", "team", "main is red").await.unwrap();
    daemon
        .session_prompt(&receiver, "queued", vec![])
        .await
        .unwrap();
    let queued = queued_prompts(&daemon, &receiver).await;
    daemon
        .session_remove_queued(&receiver, &queued[0].id)
        .await
        .unwrap();
    std::fs::write(&agent.gate, "go").unwrap();
    let log = agent.log.clone();
    wait_idle(&daemon, &receiver).await;

    daemon
        .session_prompt(&receiver, "later", vec![])
        .await
        .unwrap();
    eventually("the second prompt", || prompt_texts(&log).len() == 2).await;
    assert!(prompt_texts(&agent.log)[1].contains("main is red"));
}

#[tokio::test]
async fn removing_a_queued_peer_message_refuses_it_and_frees_the_slot() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, true);
    let daemon = seeded(memory_store());
    let receiver = start(&daemon, &agent).await;

    let id = send(&daemon, "t_a", &receiver, "hello")
        .await
        .unwrap()
        .message
        .unwrap()
        .id;
    let queued = queued_prompts(&daemon, &receiver).await;
    daemon
        .session_remove_queued(&receiver, &queued[0].id)
        .await
        .unwrap();
    wait_for_status(&daemon, id, wire::PeerMessageStatus::Refused).await;
    assert!(record(&daemon, id)
        .await
        .reason
        .unwrap()
        .contains("dropped"));
    let again = send(&daemon, "t_a", &receiver, "hello again")
        .await
        .unwrap_err();
    assert!(
        again.contains("seconds to the same peer"),
        "the slot is free: {again}"
    );
    std::fs::write(&agent.gate, "go").unwrap();
}

#[tokio::test]
async fn a_held_message_is_delivered_when_the_peer_is_resumed() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("recovery.log");
    let store = memory_store();
    let mut idle = task("t_idle", "demo");
    idle.agent = format!("node {RECOVERY_FIXTURE} {}", log.display());
    idle.session_id = Some("persisted-session".into());
    store.upsert_task(&idle).unwrap();
    let daemon = seeded(store);

    let held = send(&daemon, "t_a", "t_idle", "read this when you are back")
        .await
        .unwrap()
        .message
        .unwrap();
    assert_eq!(held.status, wire::PeerMessageStatus::Held);

    daemon
        .session_prompt("t_idle", "resume please", vec![])
        .await
        .unwrap();
    wait_for_status(&daemon, held.id, wire::PeerMessageStatus::Delivered).await;
    let resumed_prompt = || {
        std::fs::read_to_string(&log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|line| line["method"] == "session/prompt")
    };
    eventually("the resumed session is prompted", || {
        resumed_prompt().is_some()
    })
    .await;
    let text = resumed_prompt().unwrap()["params"]["prompt"].to_string();
    assert!(text.contains("read this when you are back"), "{text}");
    assert!(text.contains("resume please"));
}

#[tokio::test]
async fn a_lost_session_holds_its_queued_peer_message_and_frees_the_slot() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, true);
    let daemon = seeded(memory_store());
    let receiver = start(&daemon, &agent).await;
    let id = send(&daemon, "t_a", &receiver, "hello")
        .await
        .unwrap()
        .message
        .unwrap()
        .id;
    queued_prompts(&daemon, &receiver).await;

    daemon.cancel_task(&receiver).await.unwrap();
    wait_for_status(&daemon, id, wire::PeerMessageStatus::Held).await;
    assert_eq!(record(&daemon, id).await.delivered_at, None);
    let again = send(&daemon, "t_a", &receiver, "hello again")
        .await
        .unwrap_err();
    assert!(
        again.contains("seconds to the same peer"),
        "the slot is free: {again}"
    );
}

/// A replacement session is live; a `TurnStarted` still queued from the
/// session before it must not deliver what that session carried.
#[tokio::test]
async fn a_turn_start_from_a_replaced_session_delivers_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("recovery.log");
    let store = memory_store();
    let mut idle = task("t_idle", "demo");
    idle.agent = format!("node {RECOVERY_FIXTURE} {}", log.display());
    idle.session_id = Some("persisted-session".into());
    store.upsert_task(&idle).unwrap();
    let held = wire::PeerMessage {
        id: 7,
        project: "demo".into(),
        from_task: Some("t_a".into()),
        to_task: Some("t_idle".into()),
        text: "for later".into(),
        created_at: 1,
        delivered_at: None,
        status: wire::PeerMessageStatus::Held,
        reason: None,
        alert: false,
        alert_cleared_at: None,
        mentions: Vec::new(),
        source_id: None,
        started_task: None,
        channel_id: None,
        from_label: None,
        to_label: None,
        from_smith_id: None,
        to_smith_id: None,
    };
    store.upsert_peer_message(&held).unwrap();
    let daemon = seeded(store);
    daemon.session_prompt("t_idle", "", vec![]).await.unwrap();
    let log_path = log.clone();
    eventually("the replacement session loads", || {
        std::fs::read_to_string(&log_path)
            .unwrap_or_default()
            .contains("session/load")
    })
    .await;

    daemon
        .send(Command::InjectAcpUpdate {
            task_id: "t_idle".into(),
            update: crate::daemon::acp::AcpUpdate::TurnStarted {
                run_id: 0,
                initiator: crate::daemon::acp::TurnInitiator::User,
                echo: None,
                peer: crate::daemon::prompt::PeerDelivery {
                    held: vec![held.id],
                    ..Default::default()
                },
                smith: None,
            },
        })
        .await;
    assert_eq!(
        record(&daemon, held.id).await.status,
        wire::PeerMessageStatus::Held,
        "the stale start changed nothing"
    );
}

/// The caller's own sub-agent gets today's follow-up, outside the feed.
#[tokio::test]
async fn a_message_to_the_callers_child_is_a_plain_follow_up() {
    let dir = tempfile::tempdir().unwrap();
    let agent = peer_agent(&dir, false);
    let daemon = seeded(memory_store());
    let child = daemon
        .create_task(
            "demo",
            "child work",
            &agent.command,
            vec![],
            false,
            false,
            Some("t_a".into()),
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
    let log = agent.log.clone();
    eventually("the child starts", || !prompt_texts(&log).is_empty()).await;
    wait_idle(&daemon, &child).await;

    let sent = send(&daemon, "t_a", &child, "next step").await.unwrap();
    assert_eq!(sent.relation, wire::PeerRelation::Child);
    assert!(sent.message.is_none());
    eventually("the follow-up arrives", || prompt_texts(&log).len() == 2).await;
    let followup = &prompt_texts(&agent.log)[1];
    assert!(followup.contains("next step"));
    assert!(
        !followup.contains("<peer_messages>"),
        "a child's message is not a peer's"
    );
    assert!(feed(&daemon).await.is_empty());

    let refused = send(&daemon, "t_b", &child, "not yours").await.unwrap_err();
    assert!(
        refused.contains("not this session's sub-agent or a peer"),
        "{refused}"
    );
}
