//! Server dispatcher topic: lsp.

use crate::daemon::actor::{Command, DaemonHandle};
use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

pub(super) async fn lsp_start(
    handle: &DaemonHandle,
    task_id: String,
    language: String,
    project: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::LspStart {
            task_id,
            language,
            project,
            reply: tx,
        })
        .await;
    match rx.await {
        Ok(result) => Ok(json!(result)),
        Err(_) => Err(wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: "daemon dropped the lsp.start reply".into(),
        }),
    }
}

pub(super) async fn lsp_send(
    handle: &DaemonHandle,
    server_id: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::LspSend { server_id, payload }).await;
    Ok(json!(null))
}

pub(super) async fn lsp_stop(
    handle: &DaemonHandle,
    server_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::LspStop { server_id }).await;
    Ok(json!(null))
}

pub(super) async fn language_servers_detect() -> Result<serde_json::Value, wire::RpcError> {
    let detected = crate::daemon::lsp_servers::detect_language_servers().await;
    serde_json::to_value(detected).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn language_servers_install(
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let Some(command) = crate::daemon::lsp_servers::manage_command(&id).await else {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("no automated install/update available for language server '{id}'"),
        });
    };
    let (ok, output) = crate::daemon::agents::run_manage_command(&command).await;
    Ok(json!({ "ok": ok, "command": command, "output": output }))
}
