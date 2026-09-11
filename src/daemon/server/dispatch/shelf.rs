//! Server dispatcher topic: shelf.

use crate::daemon::actor::DaemonHandle;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn shelf_list(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let list = handle.shelf_list(&task_id).await;
    serde_json::to_value(list).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn shelf_create(
    handle: &DaemonHandle,
    task_id: String,
    name: String,
    paths: Option<Vec<String>>,
) -> Result<serde_json::Value, wire::RpcError> {
    let entry = handle
        .shelf_create(&task_id, name, paths)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    serde_json::to_value(entry).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn shelf_get(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let diff = handle
        .shelf_get(&task_id, &id)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    serde_json::to_value(diff).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn shelf_apply(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
    drop: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .shelf_apply(&task_id, &id, drop)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn shelf_drop(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .shelf_drop(&task_id, &id)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn stash_list(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let list = handle.stash_list(&task_id).await;
    serde_json::to_value(list).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn stash_push(
    handle: &DaemonHandle,
    task_id: String,
    message: String,
    paths: Option<Vec<String>>,
) -> Result<serde_json::Value, wire::RpcError> {
    let entry = handle
        .stash_push(&task_id, message, paths)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    serde_json::to_value(entry).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn stash_get(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let diff = handle
        .stash_get(&task_id, &id)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    serde_json::to_value(diff).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn stash_apply(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
    pop: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .stash_apply(&task_id, &id, pop)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn stash_file(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .stash_checkout_file(&task_id, &id, paths)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn stash_drop(
    handle: &DaemonHandle,
    task_id: String,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .stash_drop(&task_id, &id)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e,
        })?;
    Ok(json!(null))
}
