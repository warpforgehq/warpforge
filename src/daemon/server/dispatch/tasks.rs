//! Server dispatcher topic: tasks.

use crate::daemon::actor::{Command, DaemonHandle};
use crate::daemon::server::util::project_path;
use crate::daemon::worktree::{resolve_start, StartPoint};
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
    worktree_base: Option<wire::WorktreeBase>,
    parent_task_id: Option<String>,
    attachments: Vec<wire::PromptAttachment>,
    default_model: Option<String>,
    config_overrides: HashMap<String, String>,
    workflow: Option<String>,
    backlog_item_id: Option<String>,
    origin: Option<String>,
    start: bool,
    advisor: Option<wire::AdvisorPick>,
    factory: Option<wire::FactoryCreate>,
) -> Result<serde_json::Value, wire::RpcError> {
    let orchestrated = workflow.is_some() || tags.iter().any(|tag| tag == "orchestrator-chat");
    if advisor.is_some() && orchestrated {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "an advisor is only available to a single-agent task".into(),
        });
    }
    // Resolved before the task exists, so a branch that cannot be used is a
    // refusal the dialog shows, not a task that lands blocked.
    let worktree_base = match worktree_base.filter(|_| worktree) {
        Some(base) => {
            let path = project_path(handle, &project).await?;
            resolve_start(std::path::Path::new(&path), &base)
                .await
                .map_err(|message| wire::RpcError {
                    code: wire::ErrorCode::InvalidRequest,
                    message,
                })?
        }
        None => StartPoint::Head,
    };
    if let (Some(workflow), Some(factory)) = (workflow.as_ref(), factory) {
        let task = crate::daemon::actor::runner::NewFactoryTask {
            project,
            prompt,
            agent: Some(agent),
            model: default_model,
            workflow: Some(workflow.clone()),
            item_id: backlog_item_id,
            run_location: factory.run_location,
            deliver: factory.deliver,
            config_overrides,
            include_runtime_context,
            attachments,
            tags,
            origin_task: parent_task_id,
        };
        return super::runner::create_factory_task(handle, task).await;
    }
    if let Some(workflow) = workflow {
        let (tx, rx) = oneshot::channel();
        handle
            .send(Command::CreateWorkflowTask {
                project,
                prompt,
                agent,
                tags,
                worktree,
                worktree_base,
                workflow,
                attachments,
                default_model,
                include_runtime_context,
                config_overrides,
                parent_task_id,
                backlog_item_id,
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
    // Only the orchestrator's spawn_agent tags a task `subagent`.
    if tags.iter().any(|tag| tag == "subagent") {
        if let Some(message) = handle.dispatch_refusal(&agent).await {
            return Err(wire::RpcError {
                code: wire::ErrorCode::AgentUnavailable,
                message,
            });
        }
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
            worktree_base,
            parent_task_id,
            attachments,
            default_model,
            config_overrides,
            backlog_item_id,
            origin,
            start,
            advisor,
            smith_id: None,
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
    remove_worktree: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    if remove_worktree {
        discard_worktree(handle, &task_id).await?;
    }
    handle.send(Command::ArchiveTask { id: task_id }).await;
    Ok(json!(null))
}

/// Refuse while the agent is mid-turn or the checkout holds work that is
/// neither pushed nor in the pull request (`pull_status::removal_blocker`).
async fn discard_worktree(handle: &DaemonHandle, task_id: &str) -> Result<(), wire::RpcError> {
    let conflict = |message: &str| wire::RpcError {
        code: wire::ErrorCode::Conflict,
        message: message.to_string(),
    };
    let tasks = handle.tasks().await;
    let Some(task) = tasks.iter().find(|task| task.id == task_id) else {
        return Err(wire::RpcError {
            code: wire::ErrorCode::NotFound,
            message: format!("unknown task {task_id}"),
        });
    };
    let Some(worktree) = task.worktree.as_deref() else {
        return Ok(());
    };
    if task.status == crate::daemon::task::TaskStatus::Running {
        return Err(conflict("wait for the agent to finish its turn"));
    }
    let head_oid = handle.pulls.head_oid(task_id);
    if let Some(reason) =
        crate::daemon::pull_status::removal_blocker(worktree, head_oid.as_deref()).await
    {
        return Err(conflict(reason));
    }
    handle
        .send(Command::DiscardWorktree {
            task_id: task_id.to_string(),
        })
        .await;
    handle.pulls.forget(task_id, &handle.event_tx);
    Ok(())
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

pub(super) async fn task_adopt(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.adopt_task(&task_id).await;
    Ok(json!(null))
}

pub(super) async fn task_merge_worktree(
    handle: &DaemonHandle,
    task_id: String,
    remove_worktree: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.merge_worktree(&task_id, remove_worktree).await;
    match result {
        Ok(message) => Ok(json!({ "ok": true, "message": message })),
        Err(e) => Err(wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        }),
    }
}

pub(super) async fn task_pull_requests(
    handle: &DaemonHandle,
    task_ids: Option<Vec<String>>,
    max_age_secs: Option<u64>,
) -> Result<serde_json::Value, wire::RpcError> {
    let pulls =
        crate::daemon::pull_status::refresh(handle, task_ids.as_deref(), max_age_secs).await;
    Ok(json!({ "pullRequests": pulls }))
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
