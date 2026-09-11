//! Server dispatcher topic: agents.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::accounts_result;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn text_generate(
    handle: &DaemonHandle,
    task_id: String,
    agent_id: String,
    kind: wire::TextGenKind,
    model: Option<String>,
    account_id: Option<String>,
    input: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let text = handle
        .generate_text(&task_id, &agent_id, kind, model, account_id, input)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!({ "text": text }))
}

pub(super) async fn text_enhance(
    handle: &DaemonHandle,
    project: String,
    agent_id: String,
    prompt: String,
    model: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let text = handle
        .enhance_text(&project, &agent_id, &prompt, model)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!({ "text": text }))
}

pub(super) async fn agents_detect(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let detected = handle.detect_agents().await;
    serde_json::to_value(detected).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn agents_update(
    handle: &DaemonHandle,
    agents: Vec<wire::AgentConfig>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.update_agents(agents).await;
    Ok(json!(null))
}

pub(super) async fn agents_install(id: String) -> Result<serde_json::Value, wire::RpcError> {
    let Some(command) = crate::daemon::agents::manage_command(&id).await else {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("no automated install/update available for agent '{id}'"),
        });
    };
    let (ok, output) = crate::daemon::agents::run_manage_command(&command).await;
    Ok(json!({ "ok": ok, "command": command, "output": output }))
}

pub(super) async fn agents_probe(
    handle: &DaemonHandle,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .probe_agent(&id)
        .await
        .map(|()| json!(null))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn agents_list(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let snapshot = handle.snapshot().await;
    Ok(json!({ "agents": snapshot.agents }))
}

pub(super) async fn accounts_list(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    Ok(json!({ "accounts": handle.list_accounts().await }))
}

pub(super) async fn accounts_import(
    handle: &DaemonHandle,
    agent_id: String,
    label: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.import_account(agent_id, label).await)
}

pub(super) async fn accounts_rename(
    handle: &DaemonHandle,
    account_id: String,
    label: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.rename_account(account_id, label).await)
}

pub(super) async fn accounts_remove(
    handle: &DaemonHandle,
    account_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.remove_account(account_id).await)
}

pub(super) async fn list_agent_limits(
    handle: &DaemonHandle,
    refresh: Option<bool>,
) -> Result<serde_json::Value, wire::RpcError> {
    let accounts = handle.list_agent_limits(refresh.unwrap_or(false)).await;
    Ok(json!({ "accounts": accounts }))
}

pub(super) async fn list_agent_spend(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let agents = handle.list_agent_spend().await;
    Ok(json!({ "agents": agents }))
}

pub(super) async fn accounts_set_active(
    handle: &DaemonHandle,
    agent_id: String,
    account_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.set_active_account(agent_id, account_id).await)
}
