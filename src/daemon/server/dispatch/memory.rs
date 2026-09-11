//! Server dispatcher topic: memory.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::memory_error;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn memory_store(
    handle: &DaemonHandle,
    content: String,
    scope: Option<String>,
    kind: Option<String>,
    tags: Option<Vec<String>>,
    project_id: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_store(
            &content,
            scope.as_deref(),
            kind.as_deref(),
            tags.as_deref(),
            project_id.as_deref(),
            None,
        )
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_search(
    handle: &DaemonHandle,
    query: String,
    scope: Option<String>,
    limit: Option<u32>,
    mode: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_search(&query, scope.as_deref(), limit, mode.as_deref())
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_list(
    handle: &DaemonHandle,
    scope: Option<String>,
    kind: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_list(scope.as_deref(), kind.as_deref(), limit, offset)
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_update(
    handle: &DaemonHandle,
    id: String,
    content: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_update(&id, &content)
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_delete(
    handle: &DaemonHandle,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_delete(&id)
        .await
        .map(|_| json!(null))
        .map_err(memory_error)
}

pub(super) async fn memory_stats(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.memory_stats().await.map_err(memory_error)
}

pub(super) async fn memory_set_embedding(
    handle: &DaemonHandle,
    mode: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .set_memory_embedding(&mode)
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_add_edge(
    handle: &DaemonHandle,
    src_id: String,
    dst_id: String,
    relation: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .memory_add_edge(&src_id, &dst_id, &relation)
        .await
        .map_err(memory_error)
}

pub(super) async fn memory_edges(
    handle: &DaemonHandle,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.memory_edges(&id).await.map_err(memory_error)
}

pub(super) async fn memory_dream(
    handle: &DaemonHandle,
    dry_run: Option<bool>,
    project_id: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let v = handle
        .memory_dream(dry_run.unwrap_or(false), project_id.as_deref())
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: e.to_string(),
        })?;
    Ok(v)
}

pub(super) async fn memory_list_compaction(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let v = handle
        .memory_list_compaction()
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: e.to_string(),
        })?;
    Ok(json!({"proposals": v}))
}

pub(super) async fn memory_resolve_compaction(
    handle: &DaemonHandle,
    id: i64,
    approve: Option<bool>,
) -> Result<serde_json::Value, wire::RpcError> {
    let status = handle
        .memory_resolve_compaction(id, approve.unwrap_or(true))
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: e.to_string(),
        })?;
    Ok(json!({"id": id, "status": status}))
}
