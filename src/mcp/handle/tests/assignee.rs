//! A board item's assignee: `@Name` becomes the Smith's `smith:<id>`.

use serde_json::{json, Value};

use super::handle_tool_call;
use crate::mcp::daemon_client::fake::FakeDaemon;
use crate::mcp::daemon_client::DaemonClient;

async fn call(daemon: &FakeDaemon, name: &str, args: Value) -> String {
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({ "name": name, "arguments": args });
    handle_tool_call(&mut client, "t_thread", "demo", false, Some(&params))
        .await
        .unwrap_or_else(|error| format!("Error: {error:#}"))
}

fn script(daemon: &FakeDaemon, method: &str, result: Value) {
    daemon
        .state()
        .results
        .entry(method.into())
        .or_default()
        .push_back(result);
}

fn sent(daemon: &FakeDaemon, method: &str) -> Value {
    daemon
        .state()
        .sent
        .iter()
        .find(|frame| frame["method"] == method)
        .map(|frame| frame["params"].clone())
        .unwrap_or_else(|| panic!("no {method} request"))
}

#[tokio::test]
async fn an_at_name_assignee_is_stored_as_the_smiths_id() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "smiths.list",
        json!({ "smiths": [{ "id": "sm_1", "name": "Ada" }] }),
    );
    script(
        &daemon,
        "backlog.create",
        json!({ "id": "b_1", "number": 1 }),
    );
    let text = call(
        &daemon,
        "create_backlog_task",
        json!({ "title": "flaky test", "assignee": "@ada" }),
    )
    .await;
    assert!(text.starts_with("Created backlog item"), "{text}");
    assert_eq!(sent(&daemon, "backlog.create")["assignee"], "smith:sm_1");

    let unknown = FakeDaemon::at("ws://a");
    script(&unknown, "smiths.list", json!({ "smiths": [] }));
    let text = call(
        &unknown,
        "create_backlog_task",
        json!({ "title": "x", "assignee": "@Bob" }),
    )
    .await;
    assert!(text.contains("no Smith is called Bob"), "{text}");
}
