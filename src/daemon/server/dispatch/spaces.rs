use tokio::sync::oneshot;
use warpforge_protocol::{ErrorCode, RpcError};

use crate::daemon::actor::spaces::{SpaceChange, SpaceCommand};
use crate::daemon::actor::{Command, DaemonHandle};

pub(super) async fn list(handle: &DaemonHandle) -> Result<serde_json::Value, RpcError> {
    request(handle, SpaceCommand::List).await
}

pub(super) async fn change(
    handle: &DaemonHandle,
    change: SpaceChange,
) -> Result<serde_json::Value, RpcError> {
    request(handle, |reply| SpaceCommand::Change { change, reply }).await
}

async fn request<T: serde::Serialize>(
    handle: &DaemonHandle,
    command: impl FnOnce(oneshot::Sender<Result<T, RpcError>>) -> SpaceCommand,
) -> Result<serde_json::Value, RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(Command::Spaces(command(tx))).await;
    let result = rx.await.map_err(|_| RpcError {
        code: ErrorCode::Internal,
        message: "Daemon stopped while handling a space request".into(),
    })??;
    serde_json::to_value(result).map_err(|err| RpcError {
        code: ErrorCode::Internal,
        message: err.to_string(),
    })
}
