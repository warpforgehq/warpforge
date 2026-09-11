//! Server dispatcher topic: orchestration.

use crate::daemon::actor::{Command, DaemonHandle};
use crate::daemon::wire as wireconv;
use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

pub(super) async fn orchestrator_read_inbox(
    handle: &DaemonHandle,
    parent_task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let results = handle.read_inbox(&parent_task_id).await;
    Ok(json!({ "results": results }))
}

pub(super) async fn orchestrator_list_agents(
    handle: &DaemonHandle,
    parent_task_id: String,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    if parent_task_id.trim().is_empty() {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "parent_task_id must not be empty".into(),
        });
    }
    let agents: Vec<wire::TaskInfo> = handle
        .tasks()
        .await
        .into_iter()
        .filter(|task| {
            task.parent_task_id.as_deref() == Some(parent_task_id.as_str())
                && project
                    .as_deref()
                    .is_none_or(|project| task.project == project)
        })
        .map(|task| wireconv::task_info(&task))
        .collect();
    Ok(json!({ "agents": agents }))
}

pub(super) async fn orchestrate_start(
    handle: &DaemonHandle,
    project: String,
    goal: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::StartOrchestration {
            project,
            goal,
            reply: tx,
        })
        .await;
    let (graph_id, task_id) = rx.await.unwrap_or_default();
    Ok(json!({ "graphId": graph_id, "taskId": task_id }))
}

pub(super) async fn orchestrate_list(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(Command::ListOrchestrations { reply: tx }).await;
    let infos = rx.await.unwrap_or_default();
    Ok(json!({ "graphs": infos }))
}

pub(super) async fn orchestrate_cancel() -> Result<serde_json::Value, wire::RpcError> {
    // TODO: wire through to orchestrator
    Ok(json!(null))
}

pub(super) async fn orchestrate_get_config(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::GetOrchestratorConfig { reply: tx })
        .await;
    let config = rx.await.unwrap_or_default();
    Ok(json!(config))
}

pub(super) async fn orchestrate_save_config(
    handle: &DaemonHandle,
    config: wire::OrchestratorConfigDto,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::SaveOrchestratorConfig { config, reply: tx })
        .await;
    let ok = rx.await.unwrap_or(false);
    Ok(json!({ "ok": ok }))
}
