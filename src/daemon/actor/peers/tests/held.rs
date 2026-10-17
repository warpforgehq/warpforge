//! A direct message to a peer with no live session is held for its next
//! prompt: never refused for that, never a reason to wake it.

use super::*;

#[tokio::test]
async fn a_peer_without_a_live_session_is_held_and_the_sender_told() {
    let daemon = seeded(memory_store());
    let sent = send(&daemon, "t_a", "t_b", "hello").await.unwrap();
    assert_eq!(sent.relation, wire::PeerRelation::Peer);
    assert_eq!(
        sent.notice.as_deref(),
        Some("work of t_b is not running; it will see your message when it is next resumed.")
    );
    let record = sent.message.unwrap();
    assert_eq!(record.status, wire::PeerMessageStatus::Held);
    assert_eq!(record.delivered_at, None);
    assert_eq!(feed(&daemon).await, vec![record]);
    let tasks = daemon.tasks().await;
    let peer = tasks.iter().find(|t| t.id == "t_b").unwrap();
    assert_eq!(
        peer.status,
        TaskStatus::Waiting,
        "a held message wakes nobody"
    );
}

#[tokio::test]
async fn a_held_message_frees_the_senders_queued_slot() {
    let daemon = seeded(memory_store());
    send(&daemon, "t_a", "t_b", "first").await.unwrap();
    let error = send(&daemon, "t_a", "t_b", "second").await.unwrap_err();
    assert!(error.contains("seconds to the same peer"), "{error}");
}

#[tokio::test]
async fn a_blocked_peer_is_still_refused() {
    let store = memory_store();
    let mut blocked = task("t_blocked", "demo");
    blocked.status = TaskStatus::Blocked;
    store.upsert_task(&blocked).unwrap();
    let daemon = seeded(store);
    let error = send(&daemon, "t_a", "t_blocked", "hello")
        .await
        .unwrap_err();
    assert!(error.contains("is blocked"), "{error}");
    assert_eq!(
        feed(&daemon).await[0].status,
        wire::PeerMessageStatus::Refused
    );
}

#[tokio::test]
async fn held_messages_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("warpforge.db");
    let daemon = seeded(Store::open_at(&path).unwrap());
    let held = send(&daemon, "t_a", "t_b", "hello")
        .await
        .unwrap()
        .message
        .unwrap();
    feed(&daemon).await;

    let restarted = Daemon::spawn(projects(), Some(Store::open_at(&path).unwrap()));
    assert_eq!(feed(&restarted).await, vec![held]);
}
