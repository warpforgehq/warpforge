//! Server dispatcher topic: keepers (`keepers.*`, ADR 0030).

use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle, KeeperCommand};
use crate::daemon::server::util::project_path;

pub(super) async fn keepers(
    handle: &DaemonHandle,
    method: wire::Method,
) -> Result<serde_json::Value, wire::RpcError> {
    match method {
        wire::Method::KeepersList { project } => {
            let path = project_path(handle, &project).await?;
            let keepers = tokio::task::spawn_blocking(move || {
                crate::daemon::keepers::list_keepers(std::path::Path::new(&path))
            })
            .await
            .unwrap_or_default();
            Ok(json!({ "keepers": keepers }))
        }
        wire::Method::KeepersState { task_id } => {
            let (tx, rx) = oneshot::channel();
            handle
                .send(Command::Keepers(KeeperCommand::State {
                    task_id,
                    reply: tx,
                }))
                .await;
            rx.await
                .unwrap_or_else(|_| Err("daemon dropped the reply".into()))
                .map(|state| json!(state))
                .map_err(|message| wire::RpcError {
                    code: wire::ErrorCode::NotFound,
                    message,
                })
        }
        _ => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "not a keepers method".into(),
        }),
    }
}
