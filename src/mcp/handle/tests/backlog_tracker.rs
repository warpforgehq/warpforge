//! `create_backlog_task` with `tracker`: the item and its GitHub or Linear issue.

use std::collections::VecDeque;

use serde_json::json;

use super::{call_single, item, last_params, methods, script};
use crate::mcp::daemon_client::fake::{Answer, FakeDaemon};

#[tokio::test]
async fn a_tracker_opens_the_issue_and_links_it_to_the_item() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "backlog.create", vec![item(7, "todo")]);
    script(
        &daemon,
        "workItem.createExternal",
        vec![json!({ "externalId": "#41", "url": "https://github.com/o/r/issues/41" })],
    );
    let args = json!({ "title": "Fix login", "body": "steps", "tracker": "github" });
    let text = call_single(&daemon, "demo", "create_backlog_task", args).await;
    assert!(text.contains("https://github.com/o/r/issues/41"), "{text}");
    assert_eq!(
        methods(&daemon),
        [
            "backlog.create",
            "workItem.createExternal",
            "backlog.attachExternal"
        ]
    );
    let sent = daemon.state().sent.clone();
    assert_eq!(sent[0]["params"]["source"], "github");
    assert_eq!(sent[1]["params"]["item_id"], "b_7");
    assert_eq!(sent[1]["params"]["provider"], "github");
    assert_eq!(last_params(&daemon)["external_id"], "#41");
}

#[tokio::test]
async fn a_failed_issue_create_removes_the_item() {
    let daemon = FakeDaemon::at("ws://a");
    script(&daemon, "backlog.create", vec![item(7, "todo")]);
    daemon.state().answers = VecDeque::from([Answer::Reply, Answer::Error]);
    let args = json!({ "title": "Fix login", "tracker": "github" });
    let text = call_single(&daemon, "demo", "create_backlog_task", args).await;
    assert!(
        text.starts_with("Error: could not create the github issue"),
        "{text}"
    );
    assert_eq!(
        methods(&daemon),
        [
            "backlog.create",
            "workItem.createExternal",
            "backlog.delete"
        ]
    );
    assert_eq!(last_params(&daemon)["item_id"], "b_7");
}

#[tokio::test]
async fn without_a_tracker_the_item_stays_local() {
    let daemon = FakeDaemon::at("ws://a");
    let text = call_single(
        &daemon,
        "demo",
        "create_backlog_task",
        json!({ "title": "x" }),
    )
    .await;
    assert!(!text.starts_with("Error"), "{text}");
    assert_eq!(methods(&daemon), ["backlog.create"]);
    assert_eq!(last_params(&daemon)["source"], "local");
}

#[tokio::test]
async fn an_unknown_tracker_is_refused_before_anything_is_created() {
    let daemon = FakeDaemon::at("ws://a");
    let args = json!({ "title": "x", "tracker": "jira" });
    let text = call_single(&daemon, "demo", "create_backlog_task", args).await;
    assert!(text.contains("valid values: github, linear"), "{text}");
    assert!(methods(&daemon).is_empty());
}
