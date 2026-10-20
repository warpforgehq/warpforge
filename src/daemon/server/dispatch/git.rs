//! Server dispatcher topic: git.

use std::path::Path;

use crate::daemon::actor::DaemonHandle;
use crate::daemon::worktree::same_path;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn git_commit(
    handle: &DaemonHandle,
    task_id: String,
    message: String,
    files: Option<Vec<String>>,
    amend: bool,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .git_commit(&task_id, &message, files, amend, project)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn git_update(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_update(&task_id).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_branches(
    handle: &DaemonHandle,
    task_id: Option<String>,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let mut list = handle.git_branches(task_id, project).await;
    if !list.worktrees.is_empty() {
        let tasks = handle.tasks().await;
        for held in &mut list.worktrees {
            held.task_id = tasks
                .iter()
                .find(|t| {
                    t.worktree
                        .as_deref()
                        .is_some_and(|w| same_path(Path::new(w), Path::new(&held.path)))
                })
                .map(|t| t.id.clone());
        }
    }
    serde_json::to_value(list).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_roots(
    handle: &DaemonHandle,
    task_id: Option<String>,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let roots = handle.git_roots(task_id, project).await;
    serde_json::to_value(roots).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_ignored(
    handle: &DaemonHandle,
    task_id: Option<String>,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let res = handle.git_ignored_files(task_id, project).await;
    serde_json::to_value(res).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_status(
    handle: &DaemonHandle,
    task_id: String,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let Some(root) = handle.resolve_root(&task_id, project).await else {
        return Err(wire::RpcError {
            code: wire::ErrorCode::NotFound,
            message: "no checkout for this task or project".into(),
        });
    };
    let status = handle
        .explorer
        .status
        .status(&root)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: format!("git status failed: {e}"),
        })?;
    serde_json::to_value(&*status).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_add(
    handle: &DaemonHandle,
    task_id: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .git_add(&task_id, paths)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn git_ignore(
    handle: &DaemonHandle,
    task_id: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .git_ignore_paths(&task_id, paths)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn git_last_commit_message(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .git_last_commit_message(&task_id)
        .await
        .map(|message| json!({ "message": message }))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })
}

pub(super) async fn git_push_info(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let info = handle
        .git_push_info(&task_id)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    serde_json::to_value(info).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_push(
    handle: &DaemonHandle,
    task_id: String,
    force: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_push(&task_id, force).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_create_pr(
    handle: &DaemonHandle,
    task_id: String,
    title: String,
    body: String,
    base: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let url = handle
        .git_create_pr(&task_id, title, body, base)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    crate::daemon::pull_status::refresh(handle, Some(&[task_id]), Some(0)).await;
    Ok(json!({ "url": url }))
}
