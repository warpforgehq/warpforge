//! The user's holds: a mute withholds the note, and a deleted task takes its
//! mute with it.

use super::*;

#[tokio::test]
async fn a_muted_sessions_note_is_withheld_from_the_list() {
    let daemon = seeded(memory_store());
    ask(&daemon, |reply| PeerCommand::SetStatusNote {
        task_id: "t_b".into(),
        text: "reviewing auth".into(),
        reply,
    })
    .await
    .unwrap();
    ask(&daemon, |reply| PeerCommand::SetMuted {
        task_id: "t_b".into(),
        muted: true,
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
    assert_eq!(peers[0].id, "t_b");
    assert_eq!(peers[0].note, None);
}

#[tokio::test]
async fn deleting_a_task_drops_its_mute_for_good() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("warpforge.db");
    let daemon = seeded(Store::open_at(&path).unwrap());
    ask(&daemon, |reply| PeerCommand::SetMuted {
        task_id: "t_b".into(),
        muted: true,
        reply,
    })
    .await
    .unwrap();
    daemon.delete_task("t_b").await.unwrap();
    let controls = ask(&daemon, |reply| PeerCommand::Controls { reply })
        .await
        .unwrap();
    assert!(controls.muted_tasks.is_empty());
    feed(&daemon).await;

    let restarted = Daemon::spawn(projects(), Some(Store::open_at(&path).unwrap()));
    let controls = ask(&restarted, |reply| PeerCommand::Controls { reply })
        .await
        .unwrap();
    assert!(controls.muted_tasks.is_empty());
}

#[tokio::test]
async fn a_hidden_session_cannot_set_a_status_note() {
    let daemon = seeded(memory_store());
    for caller in ["t_hidden", "t_child"] {
        let error = ask(&daemon, |reply| PeerCommand::SetStatusNote {
            task_id: caller.into(),
            text: "busy".into(),
            reply,
        })
        .await
        .unwrap_err();
        assert_eq!(error, super::super::HIDDEN_SELF, "{caller}");
    }
}

#[tokio::test]
async fn no_alert_is_live_after_a_restart() {
    let daemon = seeded(memory_store());
    let alerts = ask(&daemon, |reply| PeerCommand::Alerts { reply })
        .await
        .unwrap();
    assert!(alerts.is_empty());
}
