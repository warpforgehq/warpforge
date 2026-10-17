//! A Smith's board and `start_work` tools: what reaches the daemon.

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
async fn start_work_names_the_caller_and_lets_the_daemon_decide() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "smiths.startWorkFrom",
        json!({ "taskId": "t_w", "smith": "Ada" }),
    );
    let text = call(
        &daemon,
        "start_work",
        json!({ "smith": "self", "brief": "fix the flake" }),
    )
    .await;
    assert!(text.contains("as Ada (t_w) in demo"), "{text}");
    assert_eq!(
        sent(&daemon, "smiths.startWorkFrom"),
        json!({
            "from_task_id": "t_thread",
            "smith": "self",
            "project": "demo",
            "brief": "fix the flake",
            "backlog_item_id": null,
        })
    );
}
