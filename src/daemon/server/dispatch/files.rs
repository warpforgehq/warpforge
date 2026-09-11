//! Server dispatcher topic: files.

use crate::daemon::actor::{Command, DaemonHandle};
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn diff_get(
    handle: &DaemonHandle,
    task_id: String,
    include_ignored: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let diff = handle.diff(&task_id, include_ignored).await;
    serde_json::to_value(diff).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn diff_resolve_hunk(
    handle: &DaemonHandle,
    task_id: String,
    file: String,
    hunk_index: u32,
    resolution: wire::HunkResolution,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::ResolveHunk {
            task_id,
            file,
            hunk_index,
            resolution,
        })
        .await;
    Ok(json!(null))
}

pub(super) async fn file_contents(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    match handle.file_contents(&task_id, &path, project).await {
        Some(doc) => serde_json::to_value(doc).map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e.to_string(),
        }),
        None => Err(wire::RpcError {
            code: wire::ErrorCode::NotFound,
            message: format!("cannot read {path}"),
        }),
    }
}

pub(super) async fn file_list(
    handle: &DaemonHandle,
    task_id: String,
    project: Option<String>,
    include_ignored: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let files = handle.list_files(&task_id, project, include_ignored).await;
    serde_json::to_value(files).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn file_save(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
    content: String,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::SaveFile {
            task_id,
            path,
            content,
            project,
        })
        .await;
    Ok(json!(null))
}

pub(super) async fn file_create(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
    directory: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle
        .send(Command::CreateFile {
            task_id,
            path,
            directory,
            reply: tx,
        })
        .await;
    rx.await
        .map_err(|_| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: "daemon dropped file create request".into(),
        })?
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })
}

pub(super) async fn file_rename(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
    new_path: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle
        .send(Command::RenameFile {
            task_id,
            path,
            new_path,
            reply: tx,
        })
        .await;
    rx.await
        .map_err(|_| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: "daemon dropped file rename request".into(),
        })?
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })
}

pub(super) async fn file_delete(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle
        .send(Command::DeleteFile {
            task_id,
            path,
            reply: tx,
        })
        .await;
    rx.await
        .map_err(|_| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: "daemon dropped file delete request".into(),
        })?
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })
}

pub(super) async fn file_search(
    handle: &DaemonHandle,
    task_id: String,
    query: String,
    limit: u32,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let matches = handle.search_files(&task_id, &query, limit, project).await;
    serde_json::to_value(matches).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}
