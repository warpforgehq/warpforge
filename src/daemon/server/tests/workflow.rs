//! Workflow listing and ejection over the websocket.

use super::*;
use crate::daemon::{Daemon, Store};
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn workflow_list_and_eject_over_websocket() {
    type Ws = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;
    async fn rpc(
        ws: &mut Ws,
        id: u64,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        ws.send(Message::Text(
            json!({ "id": id, "method": method, "params": params }).to_string(),
        ))
        .await
        .unwrap();
        loop {
            let msg = timeout(Duration::from_secs(2), ws.next())
                .await
                .expect("frame")
                .expect("some")
                .expect("ok");
            if let Message::Text(t) = msg {
                let v: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
                if v.get("id").and_then(|i| i.as_u64()) == Some(id) {
                    return v;
                }
            }
        }
    }

    let dir = tempfile::tempdir().unwrap();
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
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
        .await
        .unwrap();

    // A fresh project sees exactly the built-in templates.
    let v = rpc(&mut ws, 1, "workflow.list", json!({ "project": "demo" })).await;
    let workflows = v["result"]["workflows"].as_array().unwrap();
    assert_eq!(workflows.len(), 2);
    assert!(workflows
        .iter()
        .all(|w| w["source"] == "builtin" && w["valid"] == true));
    assert!(workflows.iter().any(|w| w["id"] == "review-loop"));

    // Ejecting copies the built-in into .warpforge/workflows/.
    let v = rpc(
        &mut ws,
        2,
        "workflow.eject",
        json!({ "project": "demo", "id": "review-loop" }),
    )
    .await;
    let path = v["result"]["path"].as_str().unwrap();
    assert!(std::path::Path::new(path).exists());

    // The ejected copy now overrides the built-in…
    let v = rpc(&mut ws, 3, "workflow.list", json!({ "project": "demo" })).await;
    let workflows = v["result"]["workflows"].as_array().unwrap();
    let review = workflows.iter().find(|w| w["id"] == "review-loop").unwrap();
    assert_eq!(review["source"], "project");

    // …and a second eject refuses to overwrite it.
    let v = rpc(
        &mut ws,
        4,
        "workflow.eject",
        json!({ "project": "demo", "id": "review-loop" }),
    )
    .await;
    assert!(v["error"]["message"].as_str().unwrap().contains("exists"));

    // Unknown projects are rejected.
    let v = rpc(&mut ws, 5, "workflow.list", json!({ "project": "nope" })).await;
    assert!(v.get("error").is_some());
}
