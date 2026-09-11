//! Server dispatcher topic: workitem.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::{project_path, rpc_err};
use crate::daemon::tracker;
use warpforge_protocol as wire;

pub(super) async fn work_item_create_external(
    handle: &DaemonHandle,
    item_id: String,
    provider: String,
    project: String,
    title: String,
    body: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = if provider == "github" {
        Some(project_path(handle, &project).await?)
    } else {
        None
    };
    // A project pointed at a Linear team creates there; otherwise Linear
    // picks the account's first team, as it did before mapping existed.
    let linear_team = handle
        .tracker_project_settings(&project)
        .await
        .ok()
        .and_then(|settings| settings.linear_team_id);
    let (external_id, url) = tracker::create_external(
        &provider,
        repo_dir.as_deref(),
        &title,
        &body,
        linear_team.as_deref(),
    )
    .await
    .map_err(|e| rpc_err(format!("{e:#}")))?;
    let link = tracker::make_link(&item_id, &provider, &project, &external_id, &url, false);
    handle.tracker_persist_link(link).await.map_err(rpc_err)?;
    let result = wire::CreateExternalResult {
        item_id,
        provider,
        external_id,
        url,
        status: "todo".into(),
    };
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn work_item_sync_external(
    handle: &DaemonHandle,
    ids: Vec<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    // Three phases, and the middle one deliberately runs here rather
    // than in the actor: the actor loop is single-threaded and awaits
    // its handlers inline, so a tracker call made inside it stalls
    // every project until the network answers.
    let (links, repo_dirs, linear_teams) = handle.tracker_sync_inputs(ids).await;
    // Bound whole sync so a hung `gh` never blocks the daemon/RPC forever (user saw infinite spinner).
    let (synced, deleted_ids) = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tracker::fetch_links_status(&links, &repo_dirs, &linear_teams),
    )
    .await
    .unwrap_or_else(|_| {
        eprintln!("[tracker] sync timed out after 30s");
        (Vec::new(), Vec::new())
    });
    let warning = tracker::take_last_board_warning();
    let items: Vec<wire::SyncedExternalItem> =
        synced.iter().map(|(_, item)| item.clone()).collect();
    handle
        .tracker_persist_synced(synced.into_iter().map(|(link, _)| link).collect())
        .await;
    if !deleted_ids.is_empty() {
        handle.tracker_delete_items(deleted_ids.clone()).await;
    }
    serde_json::to_value(wire::SyncExternalResult {
        items,
        warning,
        deleted_ids,
    })
    .map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn work_item_import_external(
    handle: &DaemonHandle,
    project: String,
    provider: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    // Unknown project is not fatal: a Linear-only import needs no repo.
    let repo_dir = project_path(handle, &project).await.ok();
    // No mapped team means no Linear import for this project: an API key
    // sees the whole account, so an unscoped pull would adopt the same
    // issues into every project the user opens.
    let linear_team = handle
        .tracker_project_settings(&project)
        .await
        .ok()
        .and_then(|settings| settings.linear_team_id);
    let fetched = tracker::fetch_importable(
        provider.as_deref(),
        repo_dir.as_deref(),
        linear_team.as_deref(),
    )
    .await
    .map_err(|e| rpc_err(format!("{e:#}")))?;
    let (items, synced) = handle
        .tracker_adopt_imported(&project, fetched)
        .await
        .map_err(rpc_err)?;
    let warning = tracker::take_last_board_warning();
    serde_json::to_value(wire::ImportExternalResult {
        items,
        synced,
        warning,
    })
    .map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn work_item_list(
    handle: &DaemonHandle,
    project: String,
    provider: String,
    page: u32,
    page_size: u32,
    sort_by: String,
    sort_desc: bool,
    search: String,
    status: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = if provider == "github" {
        Some(project_path(handle, &project).await?)
    } else {
        None
    };
    let query = crate::daemon::backlog::Query {
        page,
        page_size,
        sort_by,
        sort_desc,
        search,
        status,
        ..Default::default()
    };
    let result = tracker::fetch_page(&provider, &project, repo_dir.as_deref(), &query)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(result).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}
