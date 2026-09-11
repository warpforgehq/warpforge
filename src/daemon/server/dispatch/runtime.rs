//! Server dispatcher topic: runtime.

use crate::daemon::actor::{Command, DaemonHandle};
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn runtime_stop_all(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StopRuntime).await;
    Ok(json!(null))
}

pub(super) async fn service_logs(
    handle: &DaemonHandle,
    project: String,
    service: String,
    after: u64,
    limit: Option<u32>,
) -> Result<serde_json::Value, wire::RpcError> {
    let (lines, at, next_seq) = handle.service_logs(&project, &service, after, limit).await;
    Ok(json!({ "lines": lines, "at": at, "nextSeq": next_seq }))
}

pub(super) async fn service_start(
    handle: &DaemonHandle,
    project: String,
    service: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::StartService { project, service })
        .await;
    Ok(json!(null))
}

pub(super) async fn service_stop(
    handle: &DaemonHandle,
    project: String,
    service: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StopService { project, service }).await;
    Ok(json!(null))
}

pub(super) async fn service_restart(
    handle: &DaemonHandle,
    project: String,
    service: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::RestartService { project, service })
        .await;
    Ok(json!(null))
}

pub(super) async fn service_start_all(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StartAllServices { project }).await;
    Ok(json!(null))
}

pub(super) async fn service_stop_all(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StopProject { project }).await;
    Ok(json!(null))
}

pub(super) async fn port_forward_start_all(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StartAllPortForwards { project }).await;
    Ok(json!(null))
}

pub(super) async fn port_forward_start(
    handle: &DaemonHandle,
    project: String,
    name: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::StartPortForward { project, name })
        .await;
    Ok(json!(null))
}

pub(super) async fn port_forward_stop(
    handle: &DaemonHandle,
    project: String,
    name: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::StopPortForward { project, name })
        .await;
    Ok(json!(null))
}

pub(super) async fn port_forward_stop_all(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::StopAllPortForwards { project }).await;
    Ok(json!(null))
}

pub(super) async fn port_forward_logs(
    handle: &DaemonHandle,
    project: String,
    name: String,
    after: u64,
    limit: Option<u32>,
) -> Result<serde_json::Value, wire::RpcError> {
    let (lines, at, next_seq) = handle.portforward_logs(&project, &name, after, limit).await;
    Ok(json!({ "lines": lines, "at": at, "nextSeq": next_seq }))
}

pub(super) async fn runtime_list(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let snapshot = handle.snapshot().await;
    let services: Vec<_> = snapshot
        .services
        .into_iter()
        .filter(|s| s.project == project)
        .collect();
    let portforwards: Vec<_> = snapshot
        .portforwards
        .into_iter()
        .filter(|pf| pf.project == project)
        .collect();
    Ok(json!({ "services": services, "portforwards": portforwards }))
}

pub(super) async fn terminal_spawn(
    handle: &DaemonHandle,
    project: String,
    command: String,
    cols: u16,
    rows: u16,
) -> Result<serde_json::Value, wire::RpcError> {
    let id = handle
        .spawn_agent(&project, &command, "", cols, rows)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::AgentUnavailable,
            message: e.to_string(),
        })?;
    Ok(json!({ "terminalId": id }))
}

pub(super) async fn terminal_input(
    handle: &DaemonHandle,
    terminal_id: String,
    data_b64: String,
) -> Result<serde_json::Value, wire::RpcError> {
    use base64::Engine;
    match base64::engine::general_purpose::STANDARD.decode(&data_b64) {
        Ok(data) => {
            handle
                .send(Command::WriteAgent {
                    id: terminal_id,
                    data,
                })
                .await;
            Ok(json!(null))
        }
        Err(e) => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("bad base64: {e}"),
        }),
    }
}

pub(super) async fn terminal_resize(
    handle: &DaemonHandle,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .send(Command::ResizeAgent {
            id: terminal_id,
            cols,
            rows,
        })
        .await;
    Ok(json!(null))
}

pub(super) async fn terminal_kill(
    handle: &DaemonHandle,
    terminal_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.send(Command::KillAgent { id: terminal_id }).await;
    Ok(json!(null))
}
