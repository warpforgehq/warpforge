//! Legacy PTY terminals over the websocket.

use super::*;
use crate::daemon::{Daemon, Store};
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn spawn_terminal_streams_screen_over_websocket() {
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: ".".into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(projects, store);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({ "id": 1, "method": "state.subscribe", "params": {} }).to_string(),
    ))
    .await
    .unwrap();

    // Spawn a PTY that prints a marker.
    ws.send(Message::Text(
        json!({
            "id": 2, "method": "terminal.spawn",
            "params": { "project": "demo", "command": "printf WARPMARK; sleep 2" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Expect a terminal.screen event whose rows contain the marker.
    let mut saw_marker = false;
    for _ in 0..40 {
        let msg = match timeout(Duration::from_secs(3), ws.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => break,
        };
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("terminal.screen") {
                let text = v["data"]["screen"].to_string();
                if text.contains("WARPMARK") {
                    saw_marker = true;
                    break;
                }
            }
        }
    }
    assert!(
        saw_marker,
        "expected a terminal.screen event containing the printed marker"
    );
}

#[tokio::test]
async fn spawn_terminal_emits_spawned_and_data_events() {
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: ".".into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(projects, store);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({ "id": 1, "method": "state.subscribe", "params": {} }).to_string(),
    ))
    .await
    .unwrap();

    ws.send(Message::Text(
        json!({
            "id": 2, "method": "terminal.spawn",
            "params": { "project": "demo", "command": "printf WARPMARK; sleep 2" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let mut saw_spawned = false;
    let mut saw_data = false;
    for _ in 0..40 {
        let msg = match timeout(Duration::from_secs(3), ws.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => break,
        };
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            let event = v.get("event").and_then(|e| e.as_str());
            if event == Some("terminal.spawned") {
                assert_eq!(v["data"]["project"].as_str(), Some("demo"));
                assert!(v["data"]["id"].as_str().is_some());
                saw_spawned = true;
            }
            if event == Some("terminal.data") {
                assert!(v["data"]["data_b64"].as_str().is_some());
                assert!(v["data"]["terminal_id"].as_str().is_some());
                saw_data = true;
            }
            if saw_spawned && saw_data {
                break;
            }
        }
    }
    assert!(saw_spawned, "expected a terminal.spawned event");
    assert!(saw_data, "expected a terminal.data event");
}
