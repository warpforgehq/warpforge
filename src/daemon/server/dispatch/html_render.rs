//! Server dispatcher topic: agent HTML renders (ADR 0025).

use std::sync::Arc;

use warpforge_protocol as wire;

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::ServerLifecycle;

fn invalid(message: String) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::InvalidRequest,
        message,
    }
}

pub(super) async fn html_render(
    handle: &DaemonHandle,
    task_id: String,
    html: String,
    title: String,
    height: f64,
) -> Result<serde_json::Value, wire::RpcError> {
    crate::daemon::html_render::publish(handle, task_id, html, title, height)
        .await
        .map_err(invalid)
}

pub(super) async fn html_preview(
    lifecycle: &Arc<ServerLifecycle>,
    _task_id: String,
    html: String,
    width: Option<i64>,
    appearance: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    crate::daemon::html_render::preview(&lifecycle.clients, html, width, appearance)
        .await
        .map_err(invalid)
}
