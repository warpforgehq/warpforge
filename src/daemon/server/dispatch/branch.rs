//! Server dispatcher topic: branch.

use crate::daemon::actor::DaemonHandle;
use warpforge_protocol as wire;

pub(super) async fn git_switch_branch(
    handle: &DaemonHandle,
    task_id: String,
    branch: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_switch_branch(&task_id, &branch).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_branch_rename(
    handle: &DaemonHandle,
    task_id: String,
    branch: String,
    new_name: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_branch_rename(&task_id, &branch, &new_name).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_branch_delete(
    handle: &DaemonHandle,
    task_id: String,
    branch: String,
    force: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_branch_delete(&task_id, &branch, force).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_branch_create(
    handle: &DaemonHandle,
    task_id: String,
    name: String,
    from: Option<String>,
    checkout: bool,
    overwrite: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle
        .git_branch_create(&task_id, &name, from, checkout, overwrite)
        .await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_rebase(
    handle: &DaemonHandle,
    task_id: String,
    branch: String,
    target: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_rebase(&task_id, &branch, &target).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn git_merge(
    handle: &DaemonHandle,
    task_id: String,
    target: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let result = handle.git_merge(&task_id, &target).await;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}
