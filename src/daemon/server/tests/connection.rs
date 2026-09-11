//! Connection loop, concurrency and lifecycle dispatch.

use super::*;
use crate::daemon::{Daemon, Store};
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

/// A request the daemon cannot parse must still be answered. Dropping it
/// leaves the caller waiting forever, which is indistinguishable from a
/// hung daemon — it showed up as a spinner that never stopped when a client
/// sent params in the wrong case.
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

/// A read must not hold up whatever is queued behind it. One connection
/// used to serve one request at a time, so a slow read delayed everything
/// after it — a tool approval was not even read off the socket until the
/// read ahead of it finished. The cheap request sent second must come back
/// first.
// Multi-threaded on purpose: the daemon runs on a multi-thread runtime, and
// on the single-threaded test default a synchronous filesystem walk inside
// a spawned task blocks the very socket read this is measuring.
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

/// Generating a title spawns an agent process and can run for minutes. It
/// used to be dispatched on the read loop, so the daemon read nothing else
/// from that client meanwhile — which is what made starting a task appear
/// to stall the conversation it was starting.
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

/// Ordered work must stay on the serial path. LSP is a streaming protocol
/// and git writes only mean what they mean in sequence.
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

/// A client that stops draining its socket must not park the connection's read
/// loop. This is the head-of-line block that froze the UI: broadcast events
/// filled the outgoing queue and the loop that reads requests was parked on
/// `send` while it drained them, so a concurrent request — the push dialog's
/// `git.pushInfo` — was never even read. Here one client is stalled and flooded
/// with events while a second client watches for the effect of a request sent
/// on the stalled connection.
// Multi-threaded on purpose: the witness and the stalled writer must make
// progress while the stalled read loop is parked.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stalled_reader_does_not_park_the_request_loop() {
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

    // The stalled client subscribes, reads the ack and snapshot, then stops
    // reading its socket.
    let (mut stalled, _) = tokio_tungstenite::connect_async(&format!("ws://{addr}"))
        .await
        .unwrap();
    stalled
        .send(Message::Text(
            json!({ "id": 1, "method": "state.subscribe", "params": { "topics": [] } }).to_string(),
        ))
        .await
        .unwrap();
    for _ in 0..2 {
        let msg = timeout(Duration::from_secs(2), stalled.next())
            .await
            .expect("subscribe ack and snapshot")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("state.snapshot") {
                break;
            }
        }
    }

    // A witness subscribes and drains in the background, watching for the
    // stalled client's request to surface as an event.
    let (mut witness, _) = tokio_tungstenite::connect_async(&format!("ws://{addr}"))
        .await
        .unwrap();
    witness
        .send(Message::Text(
            json!({ "id": 2, "method": "state.subscribe", "params": { "topics": [] } }).to_string(),
        ))
        .await
        .unwrap();
    for _ in 0..2 {
        let msg = timeout(Duration::from_secs(2), witness.next())
            .await
            .expect("subscribe ack and snapshot")
            .expect("some")
            .expect("ok");
        if let Message::Text(t) = msg {
            let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            if v.get("event").and_then(|e| e.as_str()) == Some("state.snapshot") {
                break;
            }
        }
    }
    let (seen_tx, seen_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = witness.next().await {
            if let Message::Text(t) = msg {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(t.as_str()) else {
                    continue;
                };
                if v.get("event").and_then(|e| e.as_str()) == Some("task.created")
                    && v["data"]["prompt"].as_str() == Some("probe")
                {
                    let _ = seen_tx.send(());
                    return;
                }
            }
        }
    });

    // A third client floods events. The first is far larger than any socket
    // buffer, so the stalled client's writer parks mid-frame and the outgoing
    // queue behind it fills; the stalled read loop must not park with it.
    let (mut flood, _) = tokio_tungstenite::connect_async(&format!("ws://{addr}"))
        .await
        .unwrap();
    let big = "x".repeat(2 * 1024 * 1024);
    for i in 0..6u64 {
        let prompt = if i == 0 {
            big.clone()
        } else {
            format!("flood-{i}")
        };
        flood
            .send(Message::Text(
                json!({
                    "id": 100 + i,
                    "method": "task.create",
                    "params": {
                        "project": "demo",
                        "prompt": prompt,
                        "agent": "claude",
                        "start": false
                    }
                })
                .to_string(),
            ))
            .await
            .unwrap();
        let _ = timeout(Duration::from_secs(5), flood.next()).await;
    }
    // Let the stalled writer park and its queue fill before the probe.
    tokio::time::sleep(Duration::from_millis(500)).await;

    // The probe is sent on the stalled connection, which never reads. If the
    // read loop is parked, it is never read, so the witness never sees it.
    stalled
        .send(Message::Text(
            json!({
                "id": 3,
                "method": "task.create",
                "params": {
                    "project": "demo",
                    "prompt": "probe",
                    "agent": "claude",
                    "start": false
                }
            })
            .to_string(),
        ))
        .await
        .unwrap();

    timeout(Duration::from_secs(5), seen_rx)
        .await
        .expect("the stalled client's request was never dispatched — the read loop is parked")
        .expect("probe event");
}
