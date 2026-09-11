//! Server dispatcher topic: tasks.

use crate::daemon::actor::{Command, DaemonHandle};
use serde_json::json;
use std::collections::HashMap;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

#[allow(clippy::too_many_arguments)]
pub(super) async fn task_create(
    handle: &DaemonHandle,
    project: String,
    prompt: String,
    agent: String,
    tags: Vec<String>,
    include_runtime_context: bool,
    worktree: bool,
    parent_task_id: Option<String>,
    attachments: Vec<wire::PromptAttachment>,
    default_model: Option<String>,
    config_overrides: HashMap<String, String>,
    workflow: Option<String>,
    backlog_item_id: Option<String>,
    origin: Option<String>,
    start: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    if let Some(workflow) = workflow {
        let (tx, rx) = oneshot::channel();
        handle
            .send(Command::CreateWorkflowTask {
                project,
                prompt,
                agent,
                tags,
                worktree,
                workflow,
                attachments,
                default_model,
                include_runtime_context,
                config_overrides,
                parent_task_id,
                reply: tx,
            })
            .await;
        let id = rx
            .await
            .unwrap_or_else(|_| Err("daemon closed".into()))
            .map_err(|e| wire::RpcError {
                code: wire::ErrorCode::InvalidRequest,
                message: e,
            })?;
        return Ok(json!({ "taskId": id }));
    }
    // Sent as one command rather than through `handle.create_task` /
    // `queue_task`: those are the board's own entry points and carry
    // no origin, and `start` is the only thing that differed between
    // the two branches this replaced.
    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::CreateTask {
            project,
            prompt,
            agent,
            tags,
            include_runtime_context,
            worktree,
            parent_task_id,
            attachments,
            default_model,
            config_overrides,
            backlog_item_id,
            origin,
            start,
            reply: tx,
        })
        .await;
    let id = rx.await.unwrap_or_default();
    Ok(json!({ "taskId": id }))
}

pub(super) async fn task_cancel(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .cancel_task(&task_id)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!(null))
}

pub(super) async fn task_archive(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::ArchiveTask { id: task_id }).await;
    Ok(json!(null))
}

pub(super) async fn task_delete(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .delete_task(&task_id)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!(null))
}

pub(super) async fn task_delete_settled(
    handle: &DaemonHandle,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    Ok(json!(handle.delete_settled_tasks(project).await))
}

pub(super) async fn task_set_title(
    handle: &DaemonHandle,
    task_id: String,
    title: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.set_task_title(&task_id, &title).await;
    Ok(json!(null))
}

pub(super) async fn task_merge_worktree(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.merge_worktree(&task_id).await;
    match result {
        Ok(branch) => Ok(json!({ "ok": true, "branch": branch })),
        Err(e) => Err(wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        }),
    }
}

pub(super) async fn task_list_worktrees(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let wts = handle.list_worktrees(&project).await;
    Ok(json!({ "worktrees": wts }))
}

pub(super) async fn task_settle(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .settle_task(&task_id)
        .await
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn task_unsettle(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .unsettle_task(&task_id)
        .await
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn task_snooze(
    handle: &DaemonHandle,
    task_id: String,
    until: u64,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .snooze_task(&task_id, until)
        .await
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn task_unsnooze(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .unsnooze_task(&task_id)
        .await
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn task_resume(
    handle: &DaemonHandle,
    project: String,
    agent: String,
    session_id: String,
    title: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let id = handle
        .resume_task(&project, &agent, &session_id, &title)
        .await;
    Ok(json!({ "taskId": id }))
}
