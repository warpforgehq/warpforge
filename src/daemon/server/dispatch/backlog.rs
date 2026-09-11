//! Server dispatcher topic: backlog.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::rpc_err;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn backlog_get_settings(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle.backlog_get_settings().await.map_err(rpc_err)?;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn backlog_set_storage(
    handle: &DaemonHandle,
    mode: wire::BacklogStorageMode,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle.backlog_set_storage(mode).await.map_err(rpc_err)?;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn backlog_list(
    handle: &DaemonHandle,
    project: String,
    page: u32,
    page_size: u32,
    sort_by: String,
    sort_desc: bool,
    search: String,
    status: Option<String>,
    source: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let query = crate::daemon::backlog::Query {
        page,
        page_size,
        sort_by,
        sort_desc,
        search,
        status,
        source,
        priority,
        assignee,
    };
    let page = handle.backlog_list(project, query).await.map_err(rpc_err)?;
    serde_json::to_value(page).map_err(|e| rpc_err(e.to_string()))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn backlog_create(
    handle: &DaemonHandle,
    project: String,
    title: String,
    body: String,
    status: String,
    priority: String,
    source: String,
    assignee: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let item = handle
        .backlog_create(crate::daemon::backlog::NewItem {
            project,
            title,
            body,
            status,
            priority,
            source,
            assignee,
        })
        .await
        .map_err(rpc_err)?;
    serde_json::to_value(item).map_err(|e| rpc_err(e.to_string()))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn backlog_update(
    handle: &DaemonHandle,
    item_id: String,
    project: String,
    title: Option<String>,
    body: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let item = handle
        .backlog_update(crate::daemon::backlog::ItemPatch {
            item_id,
            project,
            title,
            body,
            status,
            priority,
            assignee,
        })
        .await
        .map_err(rpc_err)?;
    serde_json::to_value(item).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn backlog_attach_external(
    handle: &DaemonHandle,
    item_id: String,
    project: String,
    provider: String,
    external_id: String,
    url: String,
    remote_status: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .backlog_attach_external(item_id, project, provider, external_id, url, remote_status)
        .await
        .map_err(rpc_err)?;
    Ok(json!({ "ok": true }))
}

pub(super) async fn backlog_delete(
    handle: &DaemonHandle,
    item_id: String,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .backlog_delete(item_id, project)
        .await
        .map_err(rpc_err)?;
    Ok(json!({ "ok": true }))
}

pub(super) async fn work_item_link_task(
    handle: &DaemonHandle,
    item_id: String,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .work_item_link_task(&item_id, &task_id)
        .await
        .map_err(rpc_err)?;
    Ok(json!({ "ok": true }))
}
