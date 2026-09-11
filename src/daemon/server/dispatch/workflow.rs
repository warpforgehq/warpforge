//! Server dispatcher topic: workflow.

use crate::daemon::actor::{Command, DaemonHandle};
use crate::daemon::server::util::{project_path, workflow_control, workflow_meta};
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn workflow_list(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let path = project_path(handle, &project).await?;
    let workflows: Vec<wire::WorkflowMeta> =
        crate::workflow_config::list_workflows(std::path::Path::new(&path))
            .into_iter()
            .map(workflow_meta)
            .collect();
    Ok(json!({ "workflows": workflows }))
}

pub(super) async fn workflow_eject(
    handle: &DaemonHandle,
    project: String,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let path = project_path(handle, &project).await?;
    let target =
        crate::workflow_config::eject_builtin(std::path::Path::new(&path), &id).map_err(|e| {
            wire::RpcError {
                code: wire::ErrorCode::InvalidRequest,
                message: format!("{e:#}"),
            }
        })?;
    Ok(json!({ "path": target.to_string_lossy() }))
}

pub(super) async fn workflow_pause(
    handle: &DaemonHandle,
    task: String,
) -> Result<serde_json::Value, wire::RpcError> {
    workflow_control(handle, |reply| Command::WorkflowPause { task, reply }).await
}

pub(super) async fn workflow_resume(
    handle: &DaemonHandle,
    task: String,
    note: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    workflow_control(handle, |reply| Command::WorkflowResume {
        task,
        note,
        reply,
    })
    .await
}

pub(super) async fn workflow_reply(
    handle: &DaemonHandle,
    task: String,
    message: String,
) -> Result<serde_json::Value, wire::RpcError> {
    workflow_control(handle, |reply| Command::WorkflowReply {
        task,
        message,
        reply,
    })
    .await
}

pub(super) async fn workflow_decide(
    handle: &DaemonHandle,
    task: String,
    decision: wire::WorkflowDecision,
    rounds: Option<u32>,
    note: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    workflow_control(handle, |reply| Command::WorkflowDecide {
        task,
        decision,
        rounds,
        note,
        reply,
    })
    .await
}
