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

pub(super) async fn task_delete(
    handle: &DaemonHandle,
    task_id: String,
    delete_folder: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    super::tasks::task_delete(handle, task_id.clone()).await?;
    if delete_folder {
        tokio::task::spawn_blocking(move || scratch::remove(&task_id, true))
            .await
            .map_err(crate::daemon::server::util::rpc_err)?
            .map_err(|e| invalid(format!("the chat is deleted, but its folder is not: {e}")))?;
    }
    Ok(json!(null))
}

pub(super) async fn chat_folder(task_id: String) -> Result<serde_json::Value, wire::RpcError> {
    let dir = scratch::chat_dir(&task_id);
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
