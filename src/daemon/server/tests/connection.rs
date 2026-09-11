//! Connection loop, concurrency and lifecycle dispatch.

use super::*;
use crate::daemon::{Daemon, Store};
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn unparseable_request_is_answered_instead_of_dropped() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(Vec::new(), store);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));
    let (mut ws, _) = tokio_tungstenite::connect_async(&format!("ws://{addr}"))
        .await
        .unwrap();

    for (id, frame) in [
        // Params that don't match the variant's fields.
        (
            7,
            json!({ "id": 7, "method": "accounts.import", "params": { "agentId": "claude", "label": "personal" } }),
        ),
        // A method this daemon has never heard of.
        (
            8,
            json!({ "id": 8, "method": "accounts.teleport", "params": {} }),
        ),
    ] {
        ws.send(Message::Text(frame.to_string())).await.unwrap();

        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("a reply, not silence")
            .expect("some")
            .expect("ok");
        let Message::Text(t) = msg else {
            panic!("expected a text frame")
        };
        let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
        assert_eq!(v["id"].as_u64(), Some(id));
        assert_eq!(v["error"]["code"], "invalid_request");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_read_does_not_delay_the_request_behind_it() {
    // A project big enough that listing it takes real time, and sized here
    // rather than inherited from the checkout so the margin is the same
    // everywhere this runs.
    let dir = tempfile::tempdir().unwrap();
    for i in 0..4000 {
        std::fs::write(dir.path().join(format!("file{i}.txt")), "x").unwrap();
    }
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(projects, store);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));
    // Without this the second request sits in the client's send buffer
    // waiting on an ACK for the first, and the test measures Nagle rather
    // than the daemon.
    let tcp = TcpStream::connect(addr).await.unwrap();
    tcp.set_nodelay(true).unwrap();
    let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://{addr}"), tcp)
        .await
        .unwrap();

    // Listing walks and stats every file; the accounts list is answered
    // from memory.
    ws.send(Message::Text(
        json!({
            "id": 1,
            "method": "file.list",
            "params": { "project": "demo", "include_ignored": true }
        })
        .to_string(),
    ))
    .await
    .unwrap();
    ws.send(Message::Text(
        json!({ "id": 2, "method": "accounts.list", "params": {} }).to_string(),
    ))
    .await
    .unwrap();

    // Both are answered; the order is the point.
    let mut ids = Vec::new();
    for _ in 0..2 {
        let msg = timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("a reply, not silence")
            .expect("some")
            .expect("ok");
        let Message::Text(text) = msg else {
            panic!("expected a text frame")
        };
        let reply: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
        ids.push(reply["id"].as_u64());
    }
    assert_eq!(
        ids,
        vec![Some(2), Some(1)],
        "the cheap request must not wait behind the project listing"
    );
}

#[test]
fn the_slowest_requests_do_not_block_the_connection() {
    use wire::Method::*;
    for method in [
        TextGenerate {
            task_id: "t".into(),
            agent_id: "claude".into(),
            kind: wire::TextGenKind::TaskTitle,
            model: None,
            account_id: None,
            input: None,
        },
        AgentsInstall {
            id: "claude".into(),
        },
        LanguageServersInstall { id: "rust".into() },
    ] {
        assert!(
            method_runs_concurrently(&method),
            "{method:?} shells out for seconds to minutes and must not hold the read loop"
        );
    }
}

#[test]
fn ordered_requests_stay_serial() {
    use wire::Method::*;
    for method in [
        LspSend {
            server_id: "s".into(),
            payload: serde_json::Value::Null,
        },
        GitCommit {
            task_id: "t".into(),
            message: "m".into(),
            files: None,
            amend: false,
            project: None,
        },
    ] {
        assert!(
            !method_runs_concurrently(&method),
            "{method:?} depends on arriving in order"
        );
    }
}

#[tokio::test]
async fn subscribe_then_create_task_over_websocket() {
    // Daemon with one project, in-memory store.
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: ".".into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let handle = Daemon::spawn(projects, store);

    // Serve on an ephemeral port with no auth.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(run(listener, handle.clone(), String::new()));

    // Connect a client.
    let url = format!("ws://{addr}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Subscribe.
    ws.send(Message::Text(
        json!({ "id": 1, "method": "state.subscribe", "params": { "topics": [] } }).to_string(),
    ))
    .await
    .unwrap();

    // Expect: an ack response, then a state.snapshot event with our project.
    let mut saw_snapshot = false;
    for _ in 0..3 {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("frame")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("state.snapshot") {
                assert_eq!(v["data"]["projects"][0]["name"], "demo");
                saw_snapshot = true;
                break;
            }
        }
    }
    assert!(saw_snapshot, "expected a state.snapshot event");

    // Create a task over the socket.
    ws.send(Message::Text(
        json!({
            "id": 2,
            "method": "task.create",
            "params": { "project": "demo", "prompt": "do it", "agent": "claude" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Expect a task.created event and a response with a taskId.
    let mut saw_created = false;
    let mut saw_response = false;
    for _ in 0..5 {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("frame")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("task.created") {
                assert_eq!(v["data"]["project"], "demo");
                assert_eq!(v["data"]["prompt"], "do it");
                saw_created = true;
            }
            if v.get("id").and_then(|i| i.as_u64()) == Some(2) {
                assert!(v["result"]["taskId"].as_str().unwrap().starts_with("t_"));
                saw_response = true;
            }
        }
        if saw_created && saw_response {
            break;
        }
    }
    assert!(saw_created, "expected a task.created event");
    assert!(saw_response, "expected a response with a taskId");
}

#[tokio::test]
async fn lifecycle_methods_dispatch_over_websocket() {
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

    let url = format!("ws://{addr}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Subscribe first to receive events
    ws.send(Message::Text(
        json!({ "id": 1, "method": "state.subscribe", "params": { "topics": [] } }).to_string(),
    ))
    .await
    .unwrap();

    // Wait for snapshot
    let mut saw_snapshot = false;
    for _ in 0..3 {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("frame")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("state.snapshot") {
                saw_snapshot = true;
                break;
            }
        }
    }
    assert!(saw_snapshot, "expected a state.snapshot event");

    // Create a task
    ws.send(Message::Text(
        json!({
            "id": 2,
            "method": "task.create",
            "params": { "project": "demo", "prompt": "test", "agent": "claude" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Wait for task.created event and response
    let mut task_id = None;
    let mut saw_response = false;
    for _ in 0..5 {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("frame")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("task.created") {
                task_id = v["data"]["id"].as_str().map(String::from);
            }
            if v.get("id").and_then(|i| i.as_u64()) == Some(2) {
                saw_response = true;
            }
            if task_id.is_some() && saw_response {
                break;
            }
        }
    }
    let task_id = task_id.expect("task created");

    // Test task.settle
    ws.send(Message::Text(
        json!({
            "id": 3,
            "method": "task.settle",
            "params": { "task_id": task_id }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Wait for response (may be preceded by task.updated events)
    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(3) {
                assert!(v.get("result").is_some());
                assert!(v.get("error").is_none());
                break;
            }
        }
    }

    // Test task.unsettle
    ws.send(Message::Text(
        json!({
            "id": 4,
            "method": "task.unsettle",
            "params": { "task_id": task_id }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(4) {
                assert!(v.get("result").is_some());
                break;
            }
        }
    }

    // Test task.snooze with future timestamp
    let future = crate::daemon::task::now_secs() + 3600;
    ws.send(Message::Text(
        json!({
            "id": 5,
            "method": "task.snooze",
            "params": { "task_id": task_id, "until": future }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(5) {
                assert!(v.get("result").is_some());
                break;
            }
        }
    }

    // Test task.unsnooze
    ws.send(Message::Text(
        json!({
            "id": 6,
            "method": "task.unsnooze",
            "params": { "task_id": task_id }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(6) {
                assert!(v.get("result").is_some());
                break;
            }
        }
    }

    // Test error case: settle unknown task
    ws.send(Message::Text(
        json!({
            "id": 7,
            "method": "task.settle",
            "params": { "task_id": "nonexistent" }
        })
        .to_string(),
    ))
    .await
    .unwrap();

    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v.get("id").and_then(|i| i.as_u64()) == Some(7) {
                assert!(v.get("error").is_some());
                assert!(v["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("unknown task"));
                break;
            }
        }
    }
}
