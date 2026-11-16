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
            ask(
                handle,
                wire::ErrorCode::NotFound,
                |reply| KeeperCommand::State { task_id, reply },
                |state| json!(state),
            )
            .await
        }
        wire::Method::KeepersDismiss {
            task_id,
            finding_id,
            reason,
        } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::Dismiss {
                    task_id,
                    finding_id,
                    reason,
                    reply,
                },
                |()| json!({ "ok": true }),
            )
            .await
        }
        wire::Method::KeepersAcceptReply {
            task_id,
            finding_id,
        } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::AcceptReply {
                    task_id,
                    finding_id,
                    reply,
                },
                |()| json!({ "ok": true }),
            )
            .await
        }
        wire::Method::KeepersDecide {
            task_id,
            keeper_id,
            decision,
            rounds,
            note,
        } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::Decide {
                    task_id,
                    keeper_id,
                    decision,
                    rounds,
                    note,
                    reply,
                },
                |()| json!({ "ok": true }),
            )
            .await
        }
        wire::Method::KeepersSetSwitch {
            task_id,
            keeper_id,
            on,
        } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::SetSwitch {
                    task_id,
                    keeper_id,
                    on,
                    reply,
                },
                |()| json!({ "ok": true }),
            )
            .await
        }
        wire::Method::KeepersSendFindings { task_id, keeper_id } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::SendFindings {
                    task_id,
                    keeper_id,
                    reply,
                },
                |()| json!({ "ok": true }),
            )
            .await
        }
        wire::Method::KeepersCheckReady { task_id } => {
            ask(
                handle,
                wire::ErrorCode::InvalidRequest,
                |reply| KeeperCommand::CheckReady { task_id, reply },
                |(head, started)| json!({ "head": head, "started": started }),
            )
            .await
        }
        _ => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "not a keepers method".into(),
        }),
    }
}

/// Ask the actor and turn its answer into a JSON reply, mapping a refusal to
/// `code`.
async fn ask<T>(
    handle: &DaemonHandle,
    code: wire::ErrorCode,
    command: impl FnOnce(oneshot::Sender<Result<T, String>>) -> KeeperCommand,
    to_json: impl FnOnce(T) -> serde_json::Value,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(Command::Keepers(command(tx))).await;
    rx.await
        .unwrap_or_else(|_| Err("daemon dropped the reply".into()))
        .map(to_json)
        .map_err(|message| wire::RpcError { code, message })
}
