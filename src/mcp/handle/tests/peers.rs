//! The peer tools: what reaches the daemon, and what the agent reads back.

use serde_json::{json, Value};

use super::handle_tool_call;
use crate::mcp::daemon_client::fake::{Answer, FakeDaemon};
use crate::mcp::daemon_client::DaemonClient;

async fn call(daemon: &FakeDaemon, orchestrator: bool, name: &str, args: Value) -> String {
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({ "name": name, "arguments": args });
    handle_tool_call(&mut client, "t_me", "demo", orchestrator, Some(&params))
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

fn methods(daemon: &FakeDaemon) -> Vec<String> {
    daemon
        .state()
        .sent
        .iter()
        .filter_map(|frame| frame["method"].as_str().map(str::to_string))
        .collect()
}

fn peer(id: &str, title: &str, note: Option<&str>) -> Value {
    json!({
        "id": id, "kind": "task", "title": title, "agent": "codex", "status": "running",
        "project": "demo", "filesChanged": 0, "updatedAt": 0, "note": note,
    })
}

#[tokio::test]
async fn a_plain_session_lists_only_its_peers() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "peers.list",
        json!({ "peers": [peer("t_b", "Fix login", Some("reviewing auth | tokens"))] }),
    );
    script(&daemon, "channels.list", json!({ "channels": [] }));
    let text = call(&daemon, false, "list_agents", json!({})).await;

    assert_eq!(methods(&daemon), vec!["peers.list", "channels.list"]);
    assert_eq!(daemon.state().sent[0]["params"]["task_id"], "t_me");
    assert!(!text.contains("relation: child"), "{text}");
    assert!(text.contains("## Peers (relation: peer)"), "{text}");
    assert!(
        text.contains("| t_b | Fix login | codex | running | reviewing auth / tokens |"),
        "{text}"
    );
}

#[tokio::test]
async fn an_orchestrator_lists_its_children_before_its_peers() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "orchestrator.listAgents", json!({ "agents": [] }));
    script(&daemon, "peers.list", json!({ "peers": [] }));
    script(&daemon, "channels.list", json!({ "channels": [] }));
    let text = call(&daemon, true, "list_agents", json!({})).await;

    assert_eq!(
        methods(&daemon),
        vec!["orchestrator.listAgents", "peers.list", "channels.list"]
    );
    let children = text
        .find("## Sub-agents (relation: child)")
        .expect("children");
    let peers = text.find("## Peers (relation: peer)").expect("peers");
    assert!(children < peers, "{text}");
    assert!(text.contains("No sub-agent sessions"), "{text}");
    assert!(text.contains("No other Warpforge sessions"), "{text}");
}

#[tokio::test]
async fn list_agents_names_general_and_the_callers_channels() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "peers.list", json!({ "peers": [] }));
    script(
        &daemon,
        "channels.list",
        json!({ "channels": [{ "id": "ch_1", "project": "demo", "name": "design",
                               "members": [{ "smithId": "sm_1", "name": "Ada" },
                                           { "smithId": "sm_2", "name": "Bo" }],
                               "createdAt": 0, "lastPostAt": 1 }] }),
    );
    let text = call(&daemon, false, "list_agents", json!({})).await;

    assert_eq!(
        daemon.state().sent[1]["params"],
        json!({ "task_id": "t_me" })
    );
    let channels = text.find("## Channels").expect("channels");
    assert!(text.find("## Peers").unwrap() < channels, "{text}");
    assert!(
        text.contains("| #general | every session in this project | |"),
        "{text}"
    );
    assert!(text.contains("| #design (demo) | Ada, Bo | "), "{text}");
}

#[tokio::test]
async fn a_hidden_caller_gets_no_channels_section() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "peers.list",
        json!({ "peers": [], "hidden": true }),
    );
    let text = call(&daemon, false, "list_agents", json!({})).await;

    assert_eq!(methods(&daemon), vec!["peers.list"]);
    assert!(!text.contains("## Channels"), "{text}");
    assert!(!text.contains("message_agent"), "{text}");
}

#[tokio::test]
async fn a_post_to_a_named_channel_is_reported_by_its_name() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "session.message", json!({ "relation": "team" }));
    let text = call(
        &daemon,
        false,
        "message_agent",
        json!({ "task_id": "#design", "message": "hi" }),
    )
    .await;
    assert!(text.starts_with("Posted to #design."), "{text}");
}

#[tokio::test]
async fn message_agent_lets_the_daemon_resolve_the_target_for_every_session() {
    for (orchestrator, result, expected) in [
        (true, json!({ "relation": "child" }), "sub-agent task t_x"),
        (
            false,
            json!({ "relation": "peer", "toLabel": "Fix login" }),
            "Message sent to Fix login (t_x)",
        ),
        (
            false,
            json!({ "relation": "peer", "toLabel": "Fix login",
                    "notice": "Fix login is not running; it will see your message when it is next resumed." }),
            "is not running",
        ),
        (
            false,
            json!({ "relation": "team" }),
            "Posted to the team channel",
        ),
        (
            false,
            json!({ "relation": "team",
                    "message": { "id": 3, "project": "demo", "text": "hi", "createdAt": 1,
                                 "status": "posted", "mentions": ["t_b"] },
                    "notice": "@Docs: the user muted peer messages for t_c" }),
            "sent as a direct message to t_b",
        ),
    ] {
        let daemon = FakeDaemon::at("ws://a");
        script(&daemon, "session.message", result);
        let text = call(
            &daemon,
            orchestrator,
            "message_agent",
            json!({ "task_id": "t_x", "message": "hi" }),
        )
        .await;
        assert!(text.contains(expected), "{text}");
        assert_eq!(methods(&daemon), vec!["session.message"]);
        assert_eq!(
            daemon.state().sent[0]["params"],
            json!({ "from_task_id": "t_me", "to": "t_x", "message": "hi" })
        );
    }
}

#[tokio::test]
async fn a_refusal_is_the_tool_error() {
    let daemon = FakeDaemon::at("ws://a");
    daemon.state().answers.push_back(Answer::Error);
    let text = call(
        &daemon,
        false,
        "message_agent",
        json!({ "task_id": "t_nope", "message": "hi" }),
    )
    .await;
    assert!(text.starts_with("Error"), "{text}");
    assert!(
        text.contains("boom"),
        "the daemon's reason reaches the agent: {text}"
    );
}

#[tokio::test]
async fn set_status_note_names_the_calling_task() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "peers.setStatusNote", Value::Null);
    let text = call(
        &daemon,
        false,
        "set_status_note",
        json!({ "text": "on auth" }),
    )
    .await;
    assert!(text.contains("Status note set"), "{text}");
    assert_eq!(
        daemon.state().sent[0]["params"],
        json!({ "task_id": "t_me", "text": "on auth" })
    );
}

#[tokio::test]
async fn stop_and_cleanup_stay_behind_the_orchestrator_gate() {
    let daemon = FakeDaemon::at("ws://a");
    for tool in ["stop_agent", "cleanup_agents"] {
        let text = call(&daemon, false, tool, json!({ "task_id": "t_x" })).await;
        assert!(
            text.contains("only available in an orchestrator session"),
            "{text}"
        );
    }
    assert!(daemon.state().sent.is_empty());
}
