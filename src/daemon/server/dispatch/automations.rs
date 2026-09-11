//! Server dispatcher topic: automations.

use crate::daemon::actor::DaemonHandle;
use warpforge_protocol as wire;

pub(super) async fn automations(
    handle: &DaemonHandle,
    method: wire::Method,
) -> Result<serde_json::Value, wire::RpcError> {
    return crate::daemon::automations::dispatch(handle, method).await;
}
