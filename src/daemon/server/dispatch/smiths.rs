//! Server dispatcher topic: Smiths (`smiths.*`, ADR 0027).

use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle, SmithCommand};

type Reply<T> = oneshot::Sender<Result<T, String>>;

async fn ask<T: serde::Serialize>(
    handle: &DaemonHandle,
    build: impl FnOnce(Reply<T>) -> SmithCommand,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(Command::Smiths(build(tx))).await;
    rx.await
        .unwrap_or_else(|_| Err("daemon dropped the reply".into()))
        .map(|value| json!(value))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn smiths(
    handle: &DaemonHandle,
    method: wire::Method,
) -> Result<serde_json::Value, wire::RpcError> {
    match method {
        wire::Method::SmithsList {} => {
            let smiths = ask(handle, |reply| SmithCommand::List { reply }).await?;
            Ok(json!({ "smiths": smiths }))
        }
        wire::Method::SmithsGet { id } => {
            ask(handle, |reply| SmithCommand::Get { id, reply }).await
        }
        wire::Method::SmithsCreate(create) => {
            ask(handle, |reply| SmithCommand::Create {
                create: Box::new(create),
                reply,
            })
            .await
        }
        wire::Method::SmithsUpdate { id, patch } => {
            ask(handle, |reply| SmithCommand::Update {
                id,
                patch: Box::new(patch),
                reply,
            })
            .await
        }
        wire::Method::SmithsSetPaused { id, paused } => {
            ask(handle, |reply| SmithCommand::SetPaused {
                id,
                paused,
                reply,
            })
            .await
        }
        wire::Method::SmithsDelete { id } => {
            ask(handle, |reply| SmithCommand::Delete { id, reply }).await
        }
        wire::Method::SmithsAcceptIdentity { id } => {
            ask(handle, |reply| SmithCommand::AcceptIdentity { id, reply }).await
        }
        wire::Method::SmithsRevertIdentity { id } => {
            ask(handle, |reply| SmithCommand::RevertIdentity { id, reply }).await
        }
        wire::Method::SmithsStartWork {
            id,
            project,
            brief,
            backlog_item_id,
            worktree,
        } => {
            let task_id = ask(handle, |reply| SmithCommand::StartWork {
                id,
                project,
                brief,
                backlog_item_id,
                worktree,
                reply,
            })
            .await?;
            Ok(json!({ "taskId": task_id }))
        }
        wire::Method::SmithsStartWorkFrom {
            from_task_id,
            smith,
            project,
            brief,
            backlog_item_id,
            worktree,
        } => {
            let started = ask(handle, |reply| SmithCommand::StartWorkFrom {
                from: from_task_id,
                target: smith,
                project,
                brief,
                backlog_item_id,
                worktree,
                reply,
            })
            .await?;
            Ok(json!({ "taskId": started[0], "smith": started[1] }))
        }
        _ => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "not a Smith method".into(),
        }),
    }
}
