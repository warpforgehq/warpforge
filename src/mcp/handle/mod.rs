use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use super::automations;
use super::daemon_client::DaemonClient;

mod agents;
mod backlog;
mod memory;
mod runtime;
mod workflows;

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
        "create_backlog_task" | "create_task" => {
            backlog::dispatch(name, client, project, &args).await
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
        | "memory_edges" => memory::dispatch(name, client, &args, project).await,
        _ if !is_orchestrator => Err(anyhow!(
            "tool '{name}' is only available in an orchestrator session"
        )),
        "list_agent_models" | "spawn_agent" | "read_inbox" | "message_agent" | "list_agents"
        | "stop_agent" | "cleanup_agents" => {
            agents::dispatch(name, client, parent_task, project, &args).await
        }
        "spawn_workflow" | "pause_workflow" | "resume_workflow" | "answer_workflow"
        | "decide_workflow" => workflows::dispatch(name, client, parent_task, project, &args).await,
        other => match automations::handle_tool_call(other, &args, client).await? {
            Some(text) => Ok(text),
            None => Err(anyhow!("unknown tool: {other}")),
        },
    }
}
