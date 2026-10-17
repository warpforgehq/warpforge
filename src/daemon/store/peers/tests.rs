use super::*;

fn store() -> Store {
    Store::open_at(std::path::Path::new(":memory:")).unwrap()
}

fn record(id: u64, project: &str, status: wire::PeerMessageStatus) -> wire::PeerMessage {
    wire::PeerMessage {
        id,
        project: project.into(),
        from_task: Some("t_a".into()),
        to_task: Some("t_b".into()),
        text: format!("message {id}"),
        created_at: 100 + id,
        delivered_at: None,
        status,
        reason: None,
        alert: false,
        alert_cleared_at: None,
        mentions: Vec::new(),
        source_id: None,
        started_task: None,
    }
}

#[test]
fn peer_message_round_trips_and_pages_newest_first() {
    let store = store();
    let mut refused = record(1, "demo", wire::PeerMessageStatus::Refused);
    refused.reason = Some("pair window".into());
    refused.alert = true;
    let mut post = record(2, "demo", wire::PeerMessageStatus::Posted);
    post.to_task = None;
    for message in [
        &refused,
        &post,
        &record(3, "other", wire::PeerMessageStatus::Queued),
    ] {
        store.upsert_peer_message(message).unwrap();
    }

    assert_eq!(
        store.load_peer_messages(Some("demo"), None, 10).unwrap(),
        vec![post.clone(), refused.clone()]
    );
    assert_eq!(
        store.load_peer_messages(None, Some(3), 1).unwrap(),
        vec![post]
    );
    assert_eq!(store.load_peer_messages(None, None, 10).unwrap().len(), 3);
    assert_eq!(store.max_peer_message_id().unwrap(), 3);
}

#[test]
fn rewriting_a_record_updates_its_status() {
    let store = store();
    let mut message = record(1, "demo", wire::PeerMessageStatus::Queued);
    store.upsert_peer_message(&message).unwrap();
    message.status = wire::PeerMessageStatus::Delivered;
    message.delivered_at = Some(200);
    store.upsert_peer_message(&message).unwrap();
    assert_eq!(
        store.load_peer_messages(None, None, 10).unwrap(),
        vec![message]
    );
}

#[test]
fn restart_refuses_only_queued_records() {
    let store = store();
    store
        .upsert_peer_message(&record(1, "demo", wire::PeerMessageStatus::Queued))
        .unwrap();
    store
        .upsert_peer_message(&record(2, "demo", wire::PeerMessageStatus::Delivered))
        .unwrap();
    assert_eq!(store.refuse_queued_peer_messages().unwrap(), 1);
    let loaded = store.load_peer_messages(None, None, 10).unwrap();
    assert_eq!(loaded[0].status, wire::PeerMessageStatus::Delivered);
    assert_eq!(loaded[1].status, wire::PeerMessageStatus::Refused);
    assert_eq!(loaded[1].reason.as_deref(), Some(RESTART_REASON));
}

#[test]
fn cursors_and_controls_round_trip() {
    let store = store();
    assert_eq!(store.max_peer_message_id().unwrap(), 0);
    store.save_peer_cursor("t_a", 4).unwrap();
    store.save_peer_cursor("t_a", 9).unwrap();
    assert_eq!(store.load_peer_cursors().unwrap(), vec![("t_a".into(), 9)]);

    store
        .set_peer_control(PeerControl::Mute, "t_a", true)
        .unwrap();
    store
        .set_peer_control(PeerControl::Mute, "t_a", true)
        .unwrap();
    store
        .set_peer_control(PeerControl::Pause, "demo", true)
        .unwrap();
    assert_eq!(
        store.load_peer_controls(PeerControl::Mute).unwrap(),
        vec!["t_a"]
    );
    assert_eq!(
        store.load_peer_controls(PeerControl::Pause).unwrap(),
        vec!["demo"]
    );
    store
        .set_peer_control(PeerControl::Mute, "t_a", false)
        .unwrap();
    assert!(store
        .load_peer_controls(PeerControl::Mute)
        .unwrap()
        .is_empty());
}

#[test]
fn restart_clears_live_alerts_only() {
    let store = store();
    let mut live = record(1, "demo", wire::PeerMessageStatus::Refused);
    live.alert = true;
    let mut ended = record(2, "demo", wire::PeerMessageStatus::Refused);
    ended.alert = true;
    ended.alert_cleared_at = Some(50);
    for message in [
        &live,
        &ended,
        &record(3, "demo", wire::PeerMessageStatus::Refused),
    ] {
        store.upsert_peer_message(message).unwrap();
    }
    assert_eq!(store.clear_peer_alerts(900).unwrap(), 1);
    let cleared: Vec<_> = store
        .load_peer_messages(None, None, 10)
        .unwrap()
        .into_iter()
        .map(|m| m.alert_cleared_at)
        .collect();
    assert_eq!(cleared, vec![None, Some(50), Some(900)]);
}

#[test]
fn forgetting_a_task_drops_its_cursor_and_mute_but_keeps_records() {
    let store = store();
    store
        .upsert_peer_message(&record(1, "demo", wire::PeerMessageStatus::Queued))
        .unwrap();
    store.save_peer_cursor("t_a", 1).unwrap();
    store.save_peer_cursor("t_b", 1).unwrap();
    store
        .set_peer_control(PeerControl::Mute, "t_a", true)
        .unwrap();
    store
        .set_peer_control(PeerControl::Pause, "t_a", true)
        .unwrap();
    store.forget_peer_task("t_a").unwrap();
    assert_eq!(store.load_peer_cursors().unwrap(), vec![("t_b".into(), 1)]);
    assert!(store
        .load_peer_controls(PeerControl::Mute)
        .unwrap()
        .is_empty());
    assert_eq!(
        store.load_peer_controls(PeerControl::Pause).unwrap(),
        vec!["t_a"]
    );
    assert_eq!(store.load_peer_messages(None, None, 10).unwrap().len(), 1);
}

#[test]
fn held_records_and_recent_posts_load_for_the_digests() {
    let store = store();
    let mut held = record(1, "demo", wire::PeerMessageStatus::Held);
    held.to_task = Some("t_b".into());
    store.upsert_peer_message(&held).unwrap();
    for id in 2..6 {
        let mut post = record(
            id,
            if id % 2 == 0 { "demo" } else { "other" },
            wire::PeerMessageStatus::Posted,
        );
        post.to_task = None;
        store.upsert_peer_message(&post).unwrap();
    }
    assert_eq!(
        store
            .load_peer_messages_with_status(wire::PeerMessageStatus::Held)
            .unwrap(),
        vec![held]
    );
    let ids: Vec<u64> = store
        .load_recent_peer_posts(1)
        .unwrap()
        .iter()
        .map(|post| post.id)
        .collect();
    assert_eq!(ids, vec![4, 5]);
}
