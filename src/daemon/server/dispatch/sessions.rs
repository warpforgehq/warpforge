//! Server dispatcher topic: sessions.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::rpc_err;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn sessions_list(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let sessions = handle.list_sessions(&project).await;
    Ok(json!({ "sessions": sessions }))
}

pub(super) async fn session_prompt(
    handle: &DaemonHandle,
    task_id: String,
    text: String,
    attachments: Vec<wire::PromptAttachment>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .session_prompt(&task_id, &text, attachments)
        .await
        .map(|_| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn session_set_config_option(
    handle: &DaemonHandle,
    task_id: String,
    config_id: String,
    value: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .session_set_config_option(&task_id, &config_id, &value)
        .await
        .map(|()| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn session_permission(
    handle: &DaemonHandle,
    task_id: String,
    request_id: String,
    outcome: wire::PermissionOutcome,
) -> Result<serde_json::Value, wire::RpcError> {
    let outcome = match outcome {
        wire::PermissionOutcome::Allow => "allow",
        wire::PermissionOutcome::AllowAlways => "allow_always",
        wire::PermissionOutcome::Deny => "deny",
    };
    handle
        .session_permission(&task_id, &request_id, outcome)
        .await;
    Ok(json!(null))
}

pub(super) async fn session_history(
    handle: &DaemonHandle,
    task_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let updates = handle.session_history(task_id).await.map_err(rpc_err)?;
    Ok(json!({ "updates": updates }))
}
