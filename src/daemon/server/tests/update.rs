//! Update handoff: quiesce, refuse, and reopen the mutation gate.

use super::*;
use crate::daemon::Daemon;
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn handshake_reports_protocol_version_and_external_owner() {
    let handle = Daemon::spawn(Vec::new(), None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle, String::new()));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({
            "id": 1,
            "method": "system.handshake",
            "params": {
                "client_version": env!("CARGO_PKG_VERSION"),
                "protocol_version": wire::PROTOCOL_VERSION
            }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let Message::Text(frame) = timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    else {
        panic!("expected text response");
    };
    let response: serde_json::Value = serde_json::from_str(frame.as_str()).unwrap();
    assert_eq!(
        response["result"]["protocolVersion"],
        wire::PROTOCOL_VERSION
    );
    assert_eq!(response["result"]["owner"], "external");
    assert_eq!(response["result"]["protocolCompatible"], true);
    assert_eq!(response["result"]["exactVersionMatch"], true);
}

#[tokio::test]
async fn update_handoff_refuses_external_daemon() {
    let handle = Daemon::spawn(Vec::new(), None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle, String::new()));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({
            "id": 1,
            "method": "update.prepareShutdown",
            "params": {
                "expected_daemon_version": env!("CARGO_PKG_VERSION"),
                "protocol_version": wire::PROTOCOL_VERSION
            }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let Message::Text(frame) = timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    else {
        panic!("expected text response");
    };
    let response: serde_json::Value = serde_json::from_str(frame.as_str()).unwrap();
    assert_eq!(response["error"]["code"], "conflict");
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("started externally"));
}

#[tokio::test]
async fn desktop_update_handoff_acknowledges_then_stops_server() {
    let handle = Daemon::spawn(Vec::new(), None);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::Desktop));
    let server = tokio::spawn(run_controlled(listener, handle, String::new(), lifecycle));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({
            "id": 1,
            "method": "update.prepareShutdown",
            "params": {
                "expected_daemon_version": env!("CARGO_PKG_VERSION"),
                "protocol_version": wire::PROTOCOL_VERSION
            }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let Message::Text(frame) = timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    else {
        panic!("expected text response");
    };
    let response: serde_json::Value = serde_json::from_str(frame.as_str()).unwrap();
    assert_eq!(response["result"]["ready"], true);
    timeout(Duration::from_secs(2), server)
        .await
        .expect("server should stop after acknowledging handoff")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn refused_handoff_reopens_mutation_gate() {
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: ".".into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let handle = Daemon::spawn(projects, None);
    let task_id = handle
        .create_task(
            "demo",
            "keep working",
            // Keep session process alive so asynchronous ACP failure cannot
            // race the queued-task blocker assertion below.
            "sleep 60",
            Vec::new(),
            false,
            false,
            None,
            Vec::new(),
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    handle
        .set_task_status(&task_id, crate::daemon::TaskStatus::Queued)
        .await;
    // A query is an actor-queue barrier for the status update above.
    let _ = handle.tasks().await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::Desktop));
    tokio::spawn(run_controlled(listener, handle, String::new(), lifecycle));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({
            "id": 1,
            "method": "update.prepareShutdown",
            "params": {
                "expected_daemon_version": env!("CARGO_PKG_VERSION"),
                "protocol_version": wire::PROTOCOL_VERSION
            }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let Message::Text(frame) = timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    else {
        panic!("expected handoff response");
    };
    let response: serde_json::Value = serde_json::from_str(frame.as_str()).unwrap();
    assert_eq!(response["result"]["ready"], false);
    assert!(response["result"]["blockers"][0]
        .as_str()
        .unwrap()
        .contains("agent task"));

    // A refused handoff must clear quiescing so ordinary mutations work.
    ws.send(Message::Text(
        json!({
            "id": 2,
            "method": "agents.update",
            "params": { "agents": [] }
        })
        .to_string(),
    ))
    .await
    .unwrap();
    let Message::Text(frame) = timeout(Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    else {
        panic!("expected mutation response");
    };
    let response: serde_json::Value = serde_json::from_str(frame.as_str()).unwrap();
    assert_eq!(response["id"], 2);
    assert!(response.get("result").is_some());
    assert!(response.get("error").is_none());
}
