//! `fs.watch` / `fs.unwatch`: answered by the connection, because a watch
//! belongs to the connection that asked for it and ends when it closes.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use warpforge_protocol as wire;

use crate::daemon::actor::DaemonHandle;
use crate::daemon::explorer::{registry, Lease};

pub(super) struct FsWatches {
    lease: Lease,
}

impl FsWatches {
    pub(super) fn new() -> Self {
        Self {
            lease: Lease::new(Arc::clone(registry())),
        }
    }

    /// The reply to a watch request, or `None` for any other method.
    pub(super) async fn intercept(
        &self,
        handle: &DaemonHandle,
        id: u64,
        method: &wire::Method,
    ) -> Option<wire::ServerMessage> {
        let (task_id, project, watch) = match method {
            wire::Method::FsWatch { task_id, project } => (task_id, project, true),
            wire::Method::FsUnwatch { task_id, project } => (task_id, project, false),
            _ => return None,
        };
        let outcome = match root(handle, task_id, project.clone()).await {
            Err(message) => Err(message),
            Ok(root) if watch => self
                .lease
                .watch(&root, &handle.event_tx)
                .await
                .map(|info| {
                    json!(wire::WatchedRoot {
                        degraded: info.degraded,
                        root: info.root,
                    })
                })
                .map_err(|e| e.to_string()),
            Ok(root) => {
                self.lease.unwatch(&root);
                Ok(json!({}))
            }
        };
        Some(match outcome {
            Ok(result) => wire::ServerMessage::Response { id, result },
            Err(message) => wire::ServerMessage::Error {
                id,
                error: wire::RpcError {
                    code: wire::ErrorCode::NotFound,
                    message,
                },
            },
        })
    }
}

async fn root(
    handle: &DaemonHandle,
    task_id: &str,
    project: Option<String>,
) -> Result<PathBuf, String> {
    let root = handle
        .resolve_root(task_id, project)
        .await
        .ok_or("no checkout for this task or project")?;
    std::fs::canonicalize(&root).map_err(|e| format!("cannot watch {root}: {e}"))
}
