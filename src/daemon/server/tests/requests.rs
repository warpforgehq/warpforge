//! Request dispatch guards and scoping.

use super::*;
use crate::daemon::{Daemon, Store};
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn an_unparseable_range_rejects_the_add_before_registration() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(Vec::new(), store);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));
    let (mut ws, _) = tokio_tungstenite::connect_async(&format!("ws://{addr}"))
        .await
        .unwrap();

    // The path exists, so the only thing that can fail is the range —
    // an error naming the range proves parsing precedes registration.
    let dir = tempfile::tempdir().unwrap();
    ws.send(Message::Text(
        json!({
            "id": 9,
            "method": "project.add",
            "params": { "path": dir.path().to_string_lossy(), "port_range": "nonsense" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let msg = timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("a reply, not silence")
        .expect("some")
        .expect("ok");
    let Message::Text(t) = msg else {
        panic!("expected a text frame")
    };
    let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
    assert_eq!(v["error"]["code"], "invalid_request");
    assert!(
        v["error"]["message"]
            .as_str()
            .is_some_and(|m| m.contains("invalid port range")),
        "the range must be rejected by name, not by a registry error: {}",
        v["error"]["message"]
    );
}

#[tokio::test]
async fn orchestrator_list_agents_scopes_parent_and_project() {
    let projects = vec![
        ProjectEntry {
            name: "demo".into(),
            path: ".".into(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        },
        ProjectEntry {
            name: "other".into(),
            path: ".".into(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        },
    ];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(projects, store);
    let parent = handle
        .create_task(
            "demo",
            "orchestrator",
            "codex",
            vec!["orchestrator-chat".into()],
            false,
            false,
            None,
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await;
    let demo_child = handle
        .create_task(
            "demo",
            "demo child",
            "codex",
            Vec::new(),
            false,
            false,
            Some(parent.clone()),
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await;
    let _other_project_child = handle
        .create_task(
            "other",
            "other child",
            "codex",
            Vec::new(),
            false,
            false,
            Some(parent.clone()),
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await;
    let unrelated = handle
        .create_task(
            "demo",
            "unrelated child",
            "codex",
            Vec::new(),
            false,
            false,
            Some("t_other_parent".into()),
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await;

    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::External));
    let result = dispatch(
        &handle,
        wire::Method::OrchestratorListAgents {
            parent_task_id: parent,
            project: Some("demo".into()),
        },
        &lifecycle,
    )
    .await
    .unwrap();
    let agents = result["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0]["id"], demo_child);
    assert_ne!(agents[0]["id"], unrelated);
    handle.shutdown().await;
}
