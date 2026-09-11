//! Server dispatcher topic: history.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::rpc_err;
use warpforge_protocol as wire;

pub(super) async fn history_get_settings(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle.history_get_settings().await;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}

pub(super) async fn history_set_settings(
    handle: &DaemonHandle,
    retention_days: u32,
    settle_ignored_after_days: u32,
    delete_closed_after_days: u32,
) -> Result<serde_json::Value, wire::RpcError> {
    let settings = handle
        .history_set_settings(
            retention_days,
            settle_ignored_after_days,
            delete_closed_after_days,
        )
        .await
        .map_err(rpc_err)?;
    serde_json::to_value(settings).map_err(|e| rpc_err(e.to_string()))
}
