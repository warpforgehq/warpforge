//! Server dispatcher topic: tracker.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::attachment;
use crate::daemon::server::util::{project_path, rpc_err};
use crate::daemon::tracker;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn tracker_status() -> Result<serde_json::Value, wire::RpcError> {
    let status = tracker::status().await;
    serde_json::to_value(status).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_connect_linear(
    api_key: String,
) -> Result<serde_json::Value, wire::RpcError> {
    tracker::connect_linear(&api_key)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(tracker::status().await).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_disconnect_linear() -> Result<serde_json::Value, wire::RpcError> {
    tracker::disconnect_linear()
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(tracker::status().await).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_connect_github(
    token: String,
) -> Result<serde_json::Value, wire::RpcError> {
    if !token.trim().is_empty() {
        tracker::connect_github(&token)
            .await
            .map_err(|e| rpc_err(format!("{e:#}")))?;
    } else if tracker::github_login().await.is_none() && tracker::status().await.github.is_none() {
        return Err(rpc_err(
            "GitHub CLI is not authenticated. Run `gh auth login` first.".to_string(),
        ));
    }
    serde_json::to_value(tracker::status().await).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_disconnect_github() -> Result<serde_json::Value, wire::RpcError> {
    // GitHub rides on the `gh` CLI session; nothing daemon-owned to
    // delete except links, which belong to backlog items (kept).
    serde_json::to_value(tracker::status().await).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_links(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let links = handle.tracker_links().await.map_err(rpc_err)?;
    Ok(json!({ "links": links }))
}

pub(super) async fn tracker_linear_teams() -> Result<serde_json::Value, wire::RpcError> {
    let teams = tracker::linear_teams()
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    Ok(json!({ "teams": teams }))
}

pub(super) async fn tracker_attachment(url: String) -> Result<serde_json::Value, wire::RpcError> {
    let attachment = attachment::fetch(&url)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(attachment).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_project_settings(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle
        .tracker_project_settings(&project)
        .await
        .map_err(rpc_err)?;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_set_project_linear_team(
    handle: &DaemonHandle,
    project: String,
    team_id: Option<String>,
    team_name: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle
        .tracker_set_project_linear_team(project, team_id, team_name)
        .await
        .map_err(rpc_err)?;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_project_sources(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    // Same availability rules the import path enforces, surfaced so
    // the UI can hide what a project cannot use. Linear: connected key
    // plus a mapped team (an unscoped pull would adopt every project's
    // issues). GitHub: `gh` session whose repo resolves from this
    // project dir. Runs on the request task — the `gh` spawn must not
    // stall the actor loop.
    let status = tracker::status().await;
    let linear = status.linear.as_ref().is_some_and(|l| l.connected)
        && handle
            .tracker_project_settings(&project)
            .await
            .ok()
            .and_then(|settings| settings.linear_team_id)
            .is_some();
    let github = status.github.as_ref().is_some_and(|g| g.connected) && {
        match project_path(handle, &project).await {
            Ok(dir) => tracker::github_owner_repo(&dir).await.is_ok(),
            Err(_) => false,
        }
    };
    serde_json::to_value(wire::ProjectSources {
        project,
        local: true,
        linear,
        github,
    })
    .map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn tracker_pulls_list(
    handle: &DaemonHandle,
    project: String,
    state: String,
    assigned_to_me: bool,
    search: String,
    limit: u32,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let mut items = tracker::github_pr_list(&repo_dir, &state, assigned_to_me, &search, limit)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    for item in &mut items {
        item.project = project.clone();
    }
    Ok(json!({ "items": items }))
}

pub(super) async fn tracker_pull_details(
    handle: &DaemonHandle,
    project: String,
    number: u64,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let details = tracker::github_pr_details(&repo_dir, number)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(details).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_pull_diff(
    handle: &DaemonHandle,
    project: String,
    number: u64,
    from_oid: String,
    to_oid: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    // A range is two hashes or none: one alone names no comparison,
    // and silently diffing the whole pull request instead would show
    // the reviewer more than they asked to see.
    if from_oid.is_empty() != to_oid.is_empty() {
        return Err(rpc_err(
            "a commit range needs both fromOid and toOid".to_string(),
        ));
    }
    let diff = if from_oid.is_empty() {
        tracker::github_pr_diff(&repo_dir, number).await
    } else {
        tracker::github_pr_range_diff(&repo_dir, &from_oid, &to_oid).await
    }
    .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(diff).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_pull_commits(
    handle: &DaemonHandle,
    project: String,
    number: u64,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let items = tracker::github_pr_commits(&repo_dir, number)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    Ok(json!({ "items": items }))
}

pub(super) async fn tracker_pull_thread(
    handle: &DaemonHandle,
    project: String,
    number: u64,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let thread = tracker::github_pr_conversation(&repo_dir, number)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    serde_json::to_value(thread).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn tracker_pull_comment(
    handle: &DaemonHandle,
    project: String,
    number: u64,
    body: String,
    in_reply_to: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let url = tracker::github_pr_comment(&repo_dir, number, &body, &in_reply_to)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    Ok(json!({ "url": url }))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn tracker_pull_review_comment(
    handle: &DaemonHandle,
    project: String,
    number: u64,
    path: String,
    line: u64,
    side: String,
    body: String,
    start_line: Option<u64>,
    start_side: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let url = tracker::github_pr_review_comment(
        &repo_dir,
        number,
        &path,
        line,
        &side,
        &body,
        start_line,
        start_side.as_deref(),
    )
    .await
    .map_err(|e| rpc_err(format!("{e:#}")))?;
    Ok(json!({ "url": url }))
}

pub(super) async fn tracker_pull_review(
    handle: &DaemonHandle,
    project: String,
    number: u64,
    event: String,
    body: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let repo_dir = project_path(handle, &project).await?;
    let url = tracker::github_pr_review(&repo_dir, number, &event, &body)
        .await
        .map_err(|e| rpc_err(format!("{e:#}")))?;
    Ok(json!({ "url": url }))
}
