use serde_json::{json, Value};

use super::handle_tool_call;
use crate::mcp::daemon_client::fake::FakeDaemon;
use crate::mcp::daemon_client::DaemonClient;

mod backlog_tracker;
mod spawn_workflow;

async fn call_single(daemon: &FakeDaemon, project: &str, name: &str, args: Value) -> String {
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({ "name": name, "arguments": args });
    handle_tool_call(&mut client, "", project, false, Some(&params))
        .await
        .unwrap_or_else(|error| format!("Error: {error:#}"))
}

fn last_params(daemon: &FakeDaemon) -> Value {
    daemon.state().sent.last().expect("a request")["params"].clone()
}

#[tokio::test]
async fn automation_tools_reach_the_daemon_in_single_mode() {
    let daemon = FakeDaemon::at("ws://a");
    for (tool, args, method) in [
        ("automation_list", json!({}), "automation.list"),
        ("automation_get", json!({ "id": "a1" }), "automation.show"),
        (
            "automation_update",
            json!({ "id": "a1", "enabled": false }),
            "automation.update",
        ),
        (
            "automation_delete",
            json!({ "id": "a1" }),
            "automation.delete",
        ),
        (
            "automation_run_now",
            json!({ "id": "a1" }),
            "automation.runNow",
        ),
        ("automation_runs", json!({ "id": "a1" }), "automation.runs"),
    ] {
        let text = call_single(&daemon, "", tool, args).await;
        assert!(!text.starts_with("Error"), "{tool}: {text}");
        assert_eq!(
            daemon.state().sent.last().unwrap()["method"],
            method,
            "{tool}"
        );
    }
}

#[tokio::test]
async fn automation_create_defaults_to_the_current_project() {
    let daemon = FakeDaemon::at("ws://a");
    let args = json!({ "name": "n", "prompt": "p", "agent": "claude",
                       "reuse_session": true, "missed_run_grace_minutes": 5 });
    let text = call_single(&daemon, "demo", "automation_create", args).await;

    assert!(text.starts_with("Automation created"), "{text}");
    let params = last_params(&daemon);
    assert_eq!(params["project"], "demo");
    assert_eq!(params["reuse_session"], true);
    assert_eq!(params["missed_run_grace_minutes"], 5);
}

#[tokio::test]
async fn automation_create_prefers_an_explicit_project() {
    let daemon = FakeDaemon::at("ws://a");
    let args = json!({ "project": "other", "name": "n", "prompt": "p", "agent": "claude" });
    call_single(&daemon, "demo", "automation_create", args).await;

    assert_eq!(last_params(&daemon)["project"], "other");
}

#[tokio::test]
async fn automation_create_without_any_project_is_a_clear_error() {
    let daemon = FakeDaemon::at("ws://a");
    let args = json!({ "name": "n", "prompt": "p", "agent": "claude" });
    let text = call_single(&daemon, "", "automation_create", args).await;

    assert!(text.contains("'project' is required"), "{text}");
    assert!(daemon.state().sent.is_empty());
}

#[tokio::test]
async fn orchestrator_tools_stay_refused_in_single_mode() {
    let text = call_single(&FakeDaemon::at("ws://a"), "demo", "spawn_agent", json!({})).await;
    assert!(
        text.contains("only available in an orchestrator session"),
        "{text}"
    );
}

#[tokio::test]
async fn backlog_task_needs_a_title_or_prompt_at_call_time() {
    let daemon = FakeDaemon::at("ws://a");
    let text = call_single(
        &daemon,
        "demo",
        "create_backlog_task",
        json!({ "title": " " }),
    )
    .await;
    assert!(text.contains("'title' is required"), "{text}");

    let args = json!({ "title": "", "prompt": "legacy" });
    let text = call_single(&daemon, "demo", "create_backlog_task", args).await;
    assert!(text.starts_with("Created backlog item"), "{text}");
    assert_eq!(last_params(&daemon)["title"], "legacy");
}

#[tokio::test]
async fn memory_approval_from_an_agent_never_asks_for_deletion() {
    let daemon = FakeDaemon::at("ws://a");
    call_single(
        &daemon,
        "demo",
        "memory_resolve_compaction",
        json!({ "id": 3, "approve": true }),
    )
    .await;
    let sent = last_params(&daemon);
    assert_eq!(sent["approve"], true);
    assert_eq!(sent["apply"], false);
}

#[tokio::test]
async fn memory_store_records_the_sessions_task() {
    let daemon = FakeDaemon::at("ws://a");
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({ "name": "memory_store", "arguments": { "content": "a fact" } });
    for (task, expected) in [("t_42", Some("t_42")), ("", None)] {
        handle_tool_call(&mut client, task, "demo", false, Some(&params))
            .await
            .unwrap();
        let sent = last_params(&daemon);
        assert_eq!(sent.get("created_by").and_then(Value::as_str), expected);
    }
}

fn item(number: u64, status: &str) -> Value {
    json!({ "id": format!("b_{number}"), "number": number, "project": "demo",
            "title": format!("Item {number}"), "body": "old body", "status": status,
            "priority": "high", "source": "local" })
}

fn script(daemon: &FakeDaemon, method: &str, results: Vec<Value>) {
    daemon
        .state()
        .results
        .insert(method.to_string(), results.into());
}

fn page(items: Vec<Value>, has_next: bool) -> Value {
    json!({ "items": items, "page": 0, "pageSize": 100, "total": 250, "hasNextPage": has_next })
}

fn methods(daemon: &FakeDaemon) -> Vec<String> {
    let state = daemon.state();
    let sent = state.sent.iter();
    sent.map(|f| f["method"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn backlog_number_is_found_on_a_later_page() {
    let daemon = FakeDaemon::at("ws://a");
    let first = (1..=100).map(|n| item(n, "todo")).collect();
    let second = vec![item(101, "todo"), item(102, "in_progress")];
    script(
        &daemon,
        "backlog.list",
        vec![page(first, true), page(second, false)],
    );

    let text = call_single(
        &daemon,
        "demo",
        "get_backlog_task",
        json!({ "number": 102 }),
    )
    .await;

    assert!(
        text.starts_with("#102 [in_progress] [high] Item 102"),
        "{text}"
    );
    assert!(
        text.contains("id: b_102") && text.contains("old body"),
        "{text}"
    );
    assert_eq!(methods(&daemon), ["backlog.list", "backlog.list"]);
    assert_eq!(daemon.state().sent[1]["params"]["page"], 1);
}

#[tokio::test]
async fn backlog_unknown_number_is_a_clear_error() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![page(vec![item(1, "todo"), item(3, "todo")], true)],
    );

    let text = call_single(&daemon, "demo", "get_backlog_task", json!({ "number": 2 })).await;

    assert!(
        text.contains("no backlog item #2 in project 'demo'"),
        "{text}"
    );
    assert_eq!(methods(&daemon).len(), 1);
}

#[tokio::test]
async fn backlog_task_needs_a_number_or_an_id() {
    let daemon = FakeDaemon::at("ws://a");
    let text = call_single(&daemon, "demo", "get_backlog_task", json!({})).await;
    assert!(text.contains("give 'number'"), "{text}");
    assert!(daemon.state().sent.is_empty());
}

#[tokio::test]
async fn backlog_update_sends_only_the_given_fields() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![page(vec![item(87, "todo")], false)],
    );
    script(&daemon, "backlog.update", vec![item(87, "waiting")]);

    let args = json!({ "number": 87, "status": "waiting" });
    let text = call_single(&daemon, "demo", "update_backlog_task", args).await;

    assert!(text.contains("#87 [waiting]"), "{text}");
    assert_eq!(
        last_params(&daemon),
        json!({ "item_id": "b_87", "project": "demo", "status": "waiting" })
    );
}

#[tokio::test]
async fn backlog_update_rejects_an_invalid_status_before_calling_the_daemon() {
    let daemon = FakeDaemon::at("ws://a");
    let args = json!({ "number": 87, "status": "finished" });
    let text = call_single(&daemon, "demo", "update_backlog_task", args).await;

    assert!(text.contains("invalid status 'finished'"), "{text}");
    assert!(
        text.contains("todo, in_progress, waiting, done, cancelled"),
        "{text}"
    );
    let args = json!({ "number": 87, "priority": "asap" });
    let text = call_single(&daemon, "demo", "update_backlog_task", args).await;
    assert!(text.contains("none, low, medium, high, urgent"), "{text}");
    assert!(daemon.state().sent.is_empty());
}

#[tokio::test]
async fn backlog_close_sets_done_and_appends_the_note() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![page(vec![item(87, "todo")], false)],
    );
    script(&daemon, "backlog.update", vec![item(87, "done")]);

    let args = json!({ "number": 87, "note": "fixed in abc123" });
    let text = call_single(&daemon, "demo", "close_backlog_task", args).await;

    assert!(text.starts_with("Closed backlog item"), "{text}");
    let sent = last_params(&daemon);
    assert_eq!(sent["status"], "done");
    assert_eq!(sent["body"], "old body\n\nClosed: fixed in abc123");
}

#[tokio::test]
async fn backlog_close_as_cancelled_without_a_note_leaves_the_body() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![page(vec![item(7, "todo")], false)],
    );

    let args = json!({ "id": "b_7", "status": "cancelled" });
    call_single(&daemon, "demo", "close_backlog_task", args).await;

    let sent = last_params(&daemon);
    assert_eq!(sent["status"], "cancelled");
    assert!(sent.get("body").is_none(), "{sent}");
}

#[tokio::test]
async fn backlog_list_prints_one_line_per_item_and_the_total() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![page(vec![item(2, "todo"), item(1, "done")], true)],
    );

    let args = json!({ "status": "todo", "search": "cache", "limit": 500 });
    let text = call_single(&daemon, "demo", "list_backlog_tasks", args).await;

    assert_eq!(
        text,
        "#2 [todo] [high] Item 2\n#1 [done] [high] Item 1\nTotal: 250 (showing 2)"
    );
    let sent = last_params(&daemon);
    assert_eq!(sent["status"], "todo");
    assert_eq!(sent["search"], "cache");
    assert_eq!(sent["page_size"], 100);
}

#[tokio::test]
async fn runner_enqueue_resolves_numbers_and_names_the_asking_task() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "backlog.list",
        vec![
            page(vec![item(3, "todo"), item(5, "todo")], false),
            page(vec![item(3, "todo"), item(5, "todo")], false),
        ],
    );
    script(
        &daemon,
        "runner.enqueue",
        vec![json!({
            "created": [{ "taskId": "t_5", "itemId": "b_5", "started": true }],
            "skipped": [{ "itemId": "b_3", "number": 3,
                          "reason": { "kind": "already_in_factory", "taskId": "t_3" } }],
            "status": {
                "settings": { "workflow": "review-loop", "maxConcurrent": 1,
                              "maxOpenPrs": 3, "maxPerDay": 10 },
                "entries": [{ "number": 5, "state": "running", "title": "Item 5", "taskId": "t_5" },
                            { "number": 3, "state": "queued", "title": "Item 3", "taskId": "t_3",
                              "wait": { "kind": "slots", "inUse": 1, "limit": 1 } }],
                "dispatchedToday": 1,
                "hold": { "kind": "slots", "inUse": 1, "limit": 1 }
            }
        })],
    );
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    let params = json!({ "name": "runner_enqueue",
                         "arguments": { "numbers": [5, 3], "run_location": "checkout",
                                        "pull_request": false, "workflow": "verify-review-loop" } });
    let text = handle_tool_call(&mut client, "t_chat", "demo", false, Some(&params))
        .await
        .unwrap();

    let sent = last_params(&daemon);
    assert_eq!(sent["item_ids"], json!(["b_5", "b_3"]));
    assert_eq!(sent["origin_task"], "t_chat");
    assert_eq!(sent["run_location"], "checkout");
    assert_eq!(sent["deliver"], false);
    assert_eq!(sent["workflow"], "verify-review-loop");
    assert!(
        text.contains("Created 1 Factory task(s): 1 started, 0 queued."),
        "{text}"
    );
    assert!(
        text.contains("Skipped #3: already in the Factory"),
        "{text}"
    );
    assert!(
        text.contains("Queued tasks wait: waiting for a free slot (1 of 1 in use)"),
        "{text}"
    );
    assert!(text.contains("#5 [running] Item 5 (task t_5)"), "{text}");
}

#[tokio::test]
async fn runner_status_lists_recent_runs_on_request() {
    let daemon = FakeDaemon::at("ws://a");
    script(
        &daemon,
        "runner.status",
        vec![
            json!({ "settings": { "workflow": "review-loop" }, "entries": [], "dispatchedToday": 1 }),
        ],
    );
    script(
        &daemon,
        "runner.runs",
        vec![
            json!({ "runs": [{ "itemNumber": 4, "itemTitle": "Fix it", "outcome": "delivered",
                                "rounds": 2, "costUsd": 1.5,
                                "prUrl": "https://github.com/o/r/pull/9" }] }),
        ],
    );
    let text = call_single(&daemon, "demo", "runner_status", json!({ "runs": true })).await;

    assert!(text.contains("Factory — workflow review-loop"), "{text}");
    assert!(
        text.contains("No Factory tasks are queued or running."),
        "{text}"
    );
    assert!(
        text.contains(
            "#4 Fix it — delivered, 2 review round(s), $1.50, https://github.com/o/r/pull/9"
        ),
        "{text}"
    );
    assert_eq!(methods(&daemon), ["runner.status", "runner.runs"]);
}
