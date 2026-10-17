use serde_json::json;

use super::handle_tool_call;
use crate::mcp::daemon_client::fake::FakeDaemon;
use crate::mcp::daemon_client::DaemonClient;

#[tokio::test]
async fn messaging_yourself_is_its_own_error_and_never_reaches_the_daemon() {
    let daemon = FakeDaemon::at("ws://a");
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({
        "name": "message_agent",
        "arguments": { "task_id": "t_me", "message": "hi" },
    });
    let error = handle_tool_call(&mut client, "t_me", "demo", false, Some(&params))
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("can't message yourself"),
        "{error}"
    );
    assert!(daemon.state().sent.is_empty());
}
