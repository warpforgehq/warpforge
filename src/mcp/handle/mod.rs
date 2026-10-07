use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use super::automations;
use super::daemon_client::DaemonClient;

pub(crate) use advisor::ask_advisor;
pub(crate) use backlog::{PRIORITIES, STATUSES, TRACKERS};

mod advisor;
mod agents;
mod backlog;
mod browser;
mod html;
mod memory;
mod runner;
mod runtime;
mod spawn_workflow;
#[cfg(test)]
mod tests;
mod workflows;

/// Run a tool call and return its MCP `content` items. The browser tools and
/// `render_preview` return an image next to their text; every other tool
/// returns text.
/// @param client the daemon connection
/// @param parent_task the session's task
/// @param project the session's project, empty when unbound
/// @param is_orchestrator whether the orchestrator tools are available
/// @param params the `tools/call` params
/// @returns the content items, or the tool's error
pub(crate) async fn tool_content(
    client: &mut DaemonClient,
    parent_task: &str,
    project: &str,
    is_orchestrator: bool,
    params: Option<&Value>,
) -> Result<Vec<Value>> {
    let name = params
        .and_then(|p| p.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if browser::is_browser_tool(name) {
        let args = params
            .and_then(|p| p.get("arguments"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        return browser::dispatch(name, client, parent_task, project, &args).await;
    }
    if html::is_html_tool(name) {
        let args = params
            .and_then(|p| p.get("arguments"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        return html::dispatch(name, client, parent_task, &args).await;
    }
    let text = handle_tool_call(client, parent_task, project, is_orchestrator, params).await?;
    Ok(vec![json!({ "type": "text", "text": text })])
}

pub(crate) async fn handle_tool_call(
    client: &mut DaemonClient,
    parent_task: &str,
    project: &str,
    is_orchestrator: bool,
    params: Option<&Value>,
) -> Result<String> {
    let params = params.ok_or_else(|| anyhow!("missing params"))?;
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match name {
        "list_runtime"
        | "read_service_logs"
        | "read_portforward_logs"
        | "service_start"
        | "service_stop"
        | "service_restart"
        | "portforward_start"
        | "portforward_stop" => runtime::dispatch(name, client, project, &args).await,
        "create_backlog_task"
        | "create_task"
        | "list_backlog_tasks"
        | "get_backlog_task"
        | "update_backlog_task"
        | "close_backlog_task" => backlog::dispatch(name, client, project, &args).await,
        "runner_enqueue" | "runner_status" => {
            runner::dispatch(name, client, parent_task, project, &args).await
        }
        "memory_store"
        | "memory_search"
        | "memory_list"
        | "memory_update"
        | "memory_delete"
        | "memory_stats"
        | "memory_dream"
        | "memory_list_compaction"
        | "memory_resolve_compaction"
        | "memory_addEdge"
        | "memory_edges" => memory::dispatch(name, client, &args, project, parent_task).await,
        "automation_create" | "automation_list" | "automation_get" | "automation_update"
        | "automation_delete" | "automation_run_now" | "automation_runs" => {
            automations::handle_tool_call(name, &args, project, client)
                .await?
                .ok_or_else(|| anyhow!("unknown tool: {name}"))
        }
        _ if !is_orchestrator => Err(anyhow!(
            "tool '{name}' is only available in an orchestrator session"
        )),
        "list_agent_models" | "spawn_agent" | "read_inbox" | "message_agent" | "list_agents"
        | "stop_agent" | "cleanup_agents" => {
            agents::dispatch(name, client, parent_task, project, &args).await
        }
        "spawn_workflow" | "pause_workflow" | "resume_workflow" | "answer_workflow"
        | "decide_workflow" => workflows::dispatch(name, client, parent_task, project, &args).await,
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
