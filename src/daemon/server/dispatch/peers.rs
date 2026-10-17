//! Server dispatcher topic: peer sessions (`peers.*`, `session.message`,
//! ADR 0026).

use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle, PeerCommand};

type Reply<T> = oneshot::Sender<Result<T, String>>;

async fn ask<T>(
    handle: &DaemonHandle,
    build: impl FnOnce(Reply<T>) -> PeerCommand,
) -> Result<T, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(Command::Peers(build(tx))).await;
    rx.await
        .unwrap_or_else(|_| Err("daemon dropped the reply".into()))
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        })
}

pub(super) async fn peers(
    handle: &DaemonHandle,
    method: wire::Method,
) -> Result<serde_json::Value, wire::RpcError> {
    match method {
        wire::Method::PeersList { task_id } => {
            let peers = ask(handle, |reply| PeerCommand::List { task_id, reply }).await?;
            Ok(json!({ "peers": peers }))
        }
        wire::Method::PeersFeed {
            project,
            before,
            limit,
            channel,
        } => {
            let messages = ask(handle, |reply| PeerCommand::Feed {
                project,
                before,
                limit,
                channel,
                reply,
            })
            .await?;
            Ok(json!({ "messages": messages }))
        }
        wire::Method::PeersAlerts {} => {
            let messages = ask(handle, |reply| PeerCommand::Alerts { reply }).await?;
            Ok(json!({ "messages": messages }))
        }
        wire::Method::PeersControls {} => ask(handle, |reply| PeerCommand::Controls { reply })
            .await
            .map(|controls| json!(controls)),
        wire::Method::PeersSetMuted { task_id, muted } => {
            ask(handle, |reply| PeerCommand::SetMuted {
                task_id,
                muted,
                reply,
            })
            .await
            .map(|controls| json!(controls))
        }
        wire::Method::PeersSetPaused { project, paused } => {
            ask(handle, |reply| PeerCommand::SetPaused {
                project,
                paused,
                reply,
            })
            .await
            .map(|controls| json!(controls))
        }
        wire::Method::PeersSetStatusNote { task_id, text } => {
            ask(handle, |reply| PeerCommand::SetStatusNote {
                task_id,
                text,
                reply,
            })
            .await
            .map(|()| json!(null))
        }
        wire::Method::SessionMessage {
            from_task_id,
            to,
            message,
        } => ask(handle, |reply| PeerCommand::Message {
            from_task_id,
            to,
            message,
            reply,
        })
        .await
        .map(|result| json!(result)),
        wire::Method::PeersUserPost {
            project,
            text,
            channel_id,
        } => ask(handle, |reply| PeerCommand::UserPost {
            project,
            text,
            channel_id,
            reply,
        })
        .await
        .map(|result| json!(result)),
        wire::Method::PeersUserMessage { task_id, text } => {
            ask(handle, |reply| PeerCommand::UserMessage {
                task_id,
                text,
                reply,
            })
            .await
            .map(|result| json!(result))
        }
        wire::Method::PeersUserStarted { task_id, source_id } => {
            ask(handle, |reply| PeerCommand::UserStarted {
                task_id,
                source_id,
                reply,
            })
            .await
            .map(|record| json!(record))
        }
        wire::Method::ChannelsList { project, task_id } => {
            let channels = ask(handle, |reply| PeerCommand::ChannelsList {
                project,
                task_id,
                reply,
            })
            .await?;
            Ok(json!({ "channels": channels }))
        }
        wire::Method::ChannelsCreate { project, name } => {
            ask(handle, |reply| PeerCommand::ChannelsCreate {
                project,
                name,
                reply,
            })
            .await
            .map(|channel| json!(channel))
        }
        wire::Method::ChannelsRename { id, name } => ask(handle, |reply| {
            PeerCommand::ChannelsRename { id, name, reply }
        })
        .await
        .map(|channel| json!(channel)),
        wire::Method::ChannelsDelete { id } => {
            ask(handle, |reply| PeerCommand::ChannelsDelete { id, reply })
                .await
                .map(|()| json!(null))
        }
        wire::Method::ChannelsAddMember { id, smith_id } => {
            ask(handle, |reply| PeerCommand::ChannelsSetMember {
                id,
                smith_id,
                member: true,
                reply,
            })
            .await
            .map(|channel| json!(channel))
        }
        wire::Method::ChannelsRemoveMember { id, smith_id } => {
            ask(handle, |reply| PeerCommand::ChannelsSetMember {
                id,
                smith_id,
                member: false,
                reply,
            })
            .await
            .map(|channel| json!(channel))
        }
        _ => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: "not a peer method".into(),
        }),
    }
}
