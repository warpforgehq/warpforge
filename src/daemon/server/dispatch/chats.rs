//! Server dispatcher topic: chats, the tasks that have no project.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::scratch;
use serde_json::json;
use warpforge_protocol as wire;

fn invalid(message: String) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::InvalidRequest,
        message,
    }
}

/// @param pipeline whether the request asked for a workflow or the Factory
/// @returns why a chat cannot be created, as the RPC error
pub(super) fn check_create(pipeline: bool) -> Result<(), wire::RpcError> {
    if pipeline {
        return Err(invalid("a chat runs a single agent, not a workflow".into()));
    }
    match scratch::refusal(&scratch::root()) {
        Some(reason) => Err(invalid(reason)),
        None => Ok(()),
    }
}

/// @returns whether `task_id` names a chat on the board
async fn is_chat(handle: &DaemonHandle, task_id: &str) -> bool {
    handle
        .tasks()
        .await
        .iter()
        .any(|task| task.id == task_id && task.kind == wire::TaskKind::Chat)
}

pub(super) async fn task_delete(
    handle: &DaemonHandle,
    task_id: String,
    delete_folder: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let chat = delete_folder && is_chat(handle, &task_id).await;
    super::tasks::task_delete(handle, task_id.clone()).await?;
    if chat {
        tokio::task::spawn_blocking(move || scratch::remove(&task_id, true))
            .await
            .map_err(crate::daemon::server::util::rpc_err)?
            .map_err(|e| invalid(format!("the chat is deleted, but its folder is not: {e}")))?;
    }
    Ok(json!(null))
}

pub(super) async fn chat_folder(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let dir = match is_chat(handle, &task_id).await {
        true => scratch::chat_dir(&task_id),
        false => None,
    }
    .ok_or_else(|| wire::RpcError {
        code: wire::ErrorCode::NotFound,
        message: format!("no chat {task_id}"),
    })?;
    let file_count = {
        let dir = dir.clone();
        tokio::task::spawn_blocking(move || scratch::file_count(&dir))
            .await
            .map_err(crate::daemon::server::util::rpc_err)?
    };
    Ok(json!(wire::ChatFolder {
        path: dir.to_string_lossy().into_owned(),
        file_count,
    }))
}

/// The chat, the target and the project name are all checked here; the
/// client's word for any of them is not taken.
pub(super) async fn chat_create_project(
    handle: &DaemonHandle,
    task_id: String,
    path: String,
    init_git: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let src = match is_chat(handle, &task_id).await {
        true => scratch::chat_dir(&task_id),
        false => None,
    }
    .ok_or_else(|| wire::RpcError {
        code: wire::ErrorCode::NotFound,
        message: format!("no chat {task_id}"),
    })?;
    let dest =
        scratch::export::resolve_target(&path, dirs::home_dir().as_deref()).map_err(invalid)?;
    let name = dest
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    if handle.projects().await.iter().any(|p| p.name == name) {
        return Err(invalid(format!(
            "a project named {name} already exists; choose another folder name"
        )));
    }
    {
        let dest = dest.clone();
        tokio::task::spawn_blocking(move || scratch::export::export(&src, &dest, init_git))
            .await
            .map_err(crate::daemon::server::util::rpc_err)?
            .map_err(invalid)?;
    }
    let path = dest.to_string_lossy().into_owned();
    let entry = handle.add_project(&path, None, None).await.map_err(|e| {
        invalid(format!(
            "the files are in {path}, but it could not be added as a project: {e}"
        ))
    })?;
    Ok(json!({ "name": entry.name, "path": entry.path }))
}
