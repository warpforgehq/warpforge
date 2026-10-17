use std::path::Path;
use std::time::Duration;

use tokio::time::timeout;
use warpforge_protocol as wire;

mod controls;
mod delivery;
mod held;
mod mention;

use super::PeerCommand;
use crate::daemon::actor::{Command, Daemon, DaemonHandle, Event};
use crate::daemon::store::{Store, RESTART_REASON};
use crate::daemon::task::{Task, TaskStatus};
use crate::registry::ProjectEntry;

fn projects() -> Vec<ProjectEntry> {
    ["demo", "other"]
        .into_iter()
        .map(|name| ProjectEntry {
            name: name.into(),
            path: ".".into(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        })
        .collect()
}

fn task(id: &str, project: &str) -> Task {
    let mut task = Task::new(project, &format!("work of {id}"), "claude", vec![]);
    task.id = id.into();
    task.status = TaskStatus::Waiting;
    task
}

/// A daemon over `store` with the caller `t_a` and its neighbours: a peer
/// without a session, a hidden task, a child of `t_a`, and a task in another
/// project.
fn seeded(store: Store) -> DaemonHandle {
    let mut hidden = task("t_hidden", "demo");
    hidden.origin = Some("pr-review".into());
    let mut child = task("t_child", "demo");
    child.parent_task_id = Some("t_a".into());
    for task in [
        task("t_a", "demo"),
        task("t_b", "demo"),
        hidden,
        child,
        task("t_far", "other"),
    ] {
        store.upsert_task(&task).unwrap();
    }
    Daemon::spawn(projects(), Some(store))
}

fn memory_store() -> Store {
    Store::open_at(Path::new(":memory:")).unwrap()
}

async fn ask<T>(
    daemon: &DaemonHandle,
    build: impl FnOnce(tokio::sync::oneshot::Sender<Result<T, String>>) -> PeerCommand,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon.send(Command::Peers(build(tx))).await;
    rx.await.unwrap()
}

async fn send(
    daemon: &DaemonHandle,
    from: &str,
    to: &str,
    text: &str,
) -> Result<wire::PeerSendResult, String> {
    ask(daemon, |reply| PeerCommand::Message {
        from_task_id: from.into(),
        to: to.into(),
        message: text.into(),
        reply,
    })
    .await
}

async fn feed(daemon: &DaemonHandle) -> Vec<wire::PeerMessage> {
    ask(daemon, |reply| PeerCommand::Feed {
        project: None,
        before: None,
        limit: None,
        reply,
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a_hidden_target_is_refused_and_recorded() {
    let daemon = seeded(memory_store());
    let mut events = daemon.subscribe();
    let error = send(&daemon, "t_a", "t_hidden", "hello").await.unwrap_err();
    assert!(
        error.contains("not this session's sub-agent or a peer"),
        "{error}"
    );
    let record = timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(Event::PeerMessageUpdated(record)) = events.recv().await {
                break record;
            }
        }
    })
    .await
    .expect("a record for the refusal");
    assert_eq!(record.to_task.as_deref(), Some("t_hidden"));
    assert_eq!(record.status, wire::PeerMessageStatus::Refused);
    assert_eq!(record.reason.as_deref(), Some(error.as_str()));
    assert!(!record.alert);
}

#[tokio::test]
async fn an_address_outside_the_project_is_an_error_without_a_record() {
    let daemon = seeded(memory_store());
    for target in ["t_far", "t_nope", "t_a"] {
        let error = send(&daemon, "t_a", target, "hello").await.unwrap_err();
        assert!(
            error.contains("not a session in this project"),
            "{target}: {error}"
        );
    }
    assert!(feed(&daemon).await.is_empty());
}

#[tokio::test]
async fn a_hidden_caller_cannot_message_post_or_list_peers() {
    let daemon = seeded(memory_store());
    for caller in ["t_hidden", "t_child"] {
        assert_eq!(
            send(&daemon, caller, "t_b", "hello").await.unwrap_err(),
            super::HIDDEN_SELF
        );
        assert_eq!(
            send(&daemon, caller, "team", "hello").await.unwrap_err(),
            super::HIDDEN_SELF
        );
        let peers = ask(&daemon, |reply| PeerCommand::List {
            task_id: caller.into(),
            reply,
        })
        .await
        .unwrap();
        assert!(peers.is_empty(), "{caller}");
    }
    let records = feed(&daemon).await;
    assert_eq!(records.len(), 4);
    assert!(records
        .iter()
        .all(|r| r.status == wire::PeerMessageStatus::Refused));
}

#[tokio::test]
async fn an_unknown_caller_is_an_error_without_a_record() {
    let daemon = seeded(memory_store());
    assert!(send(&daemon, "t_ghost", "t_b", "hello").await.is_err());
    assert!(feed(&daemon).await.is_empty());
}

#[tokio::test]
async fn a_team_post_is_recorded_as_posted_not_delivered() {
    let daemon = seeded(memory_store());
    let sent = send(&daemon, "t_a", "team", "fyi: main is red")
        .await
        .unwrap();
    assert_eq!(sent.relation, wire::PeerRelation::Team);
    let record = sent.message.unwrap();
    assert_eq!(record.to_task, None);
    assert_eq!(record.status, wire::PeerMessageStatus::Posted);
    assert_eq!(record.delivered_at, None);
    assert_eq!(feed(&daemon).await, vec![record]);
}

#[tokio::test]
async fn the_list_holds_visible_peers_in_the_callers_project_with_their_notes() {
    let daemon = seeded(memory_store());
    ask(&daemon, |reply| PeerCommand::SetStatusNote {
        task_id: "t_b".into(),
        text: "  reviewing auth  ".into(),
        reply,
    })
    .await
    .unwrap();
    let peers = ask(&daemon, |reply| PeerCommand::List {
        task_id: "t_a".into(),
        reply,
    })
    .await
    .unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].id, "t_b");
    assert_eq!(peers[0].note.as_deref(), Some("reviewing auth"));
}

#[tokio::test]
async fn mute_and_pause_refuse_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("warpforge.db");
    let daemon = seeded(Store::open_at(&path).unwrap());
    ask(&daemon, |reply| PeerCommand::SetMuted {
        task_id: "t_a".into(),
        muted: true,
        reply,
    })
    .await
    .unwrap();
    let error = send(&daemon, "t_a", "team", "hi").await.unwrap_err();
    assert_eq!(error, super::MUTED_SELF);
    assert!(ask(&daemon, |reply| PeerCommand::SetStatusNote {
        task_id: "t_a".into(),
        text: "busy".into(),
        reply,
    })
    .await
    .is_err());
    let controls = ask(&daemon, |reply| PeerCommand::SetPaused {
        project: "demo".into(),
        paused: true,
        reply,
    })
    .await
    .unwrap();
    assert_eq!(controls.paused_projects, vec!["demo"]);
    assert_eq!(
        send(&daemon, "t_b", "team", "hi").await.unwrap_err(),
        super::PAUSED
    );
    feed(&daemon).await;

    let restarted = Daemon::spawn(projects(), Some(Store::open_at(&path).unwrap()));
    let controls = ask(&restarted, |reply| PeerCommand::Controls { reply })
        .await
        .unwrap();
    assert_eq!(
        controls,
        wire::PeerControls {
            muted_tasks: vec!["t_a".into()],
            paused_projects: vec!["demo".into()],
        }
    );
}

#[tokio::test]
async fn records_still_queued_at_startup_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("warpforge.db");
    let store = Store::open_at(&path).unwrap();
    store
        .upsert_peer_message(&wire::PeerMessage {
            id: 7,
            project: "demo".into(),
            from_task: Some("t_a".into()),
            to_task: Some("t_b".into()),
            text: "waiting".into(),
            created_at: 1,
            delivered_at: None,
            status: wire::PeerMessageStatus::Queued,
            reason: None,
            alert: true,
            alert_cleared_at: None,
            mentions: Vec::new(),
            source_id: None,
            started_task: None,
            channel_id: None,
        })
        .unwrap();
    let daemon = seeded(store);
    let records = feed(&daemon).await;
    assert_eq!(records[0].status, wire::PeerMessageStatus::Refused);
    assert_eq!(records[0].reason.as_deref(), Some(RESTART_REASON));
    assert!(
        records[0].alert_cleared_at.is_some(),
        "a restart ends every alert"
    );

    let post = send(&daemon, "t_a", "team", "after").await.unwrap();
    assert_eq!(post.message.unwrap().id, 8);
}

/// The receiver is mid-turn, so an accepted message is queued and holds the
/// sender's one queued slot for that receiver.
#[tokio::test]
async fn an_accepted_peer_message_is_queued_before_delivery() {
    let dir = tempfile::tempdir().unwrap();
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-serial.mjs"
    );
    let agent = format!(
        "node {fixture} {} 60000",
        dir.path().join("serial.log").display()
    );
    let daemon = seeded(memory_store());
    let receiver = daemon
        .create_task(
            "demo",
            "long turn",
            &agent,
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
    timeout(Duration::from_secs(10), async {
        loop {
            let running = daemon
                .tasks()
                .await
                .iter()
                .any(|t| t.id == receiver && t.status == TaskStatus::Running);
            if running {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the receiver's session started");

    let sent = send(&daemon, "t_a", &receiver, "can you look at auth?")
        .await
        .unwrap();
    assert_eq!(sent.relation, wire::PeerRelation::Peer);
    assert_eq!(
        sent.message.unwrap().status,
        wire::PeerMessageStatus::Queued
    );
    let again = send(&daemon, "t_a", &receiver, "and also")
        .await
        .unwrap_err();
    assert!(again.contains("already waiting"), "{again}");
    assert_eq!(
        feed(&daemon)
            .await
            .iter()
            .map(|r| r.status)
            .collect::<Vec<_>>(),
        vec![
            wire::PeerMessageStatus::Refused,
            wire::PeerMessageStatus::Queued
        ]
    );
}
