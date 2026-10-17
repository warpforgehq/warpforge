//! The user's side of peer messaging: the feed read, and the persisted mute
//! and pause holds the daemon enforces (ADR 0026 invariant 12).

use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::store::PeerControl;

const FEED_PAGE: u32 = 50;
const FEED_PAGE_MAX: u32 = 200;

impl Daemon {
    pub(super) fn peer_controls(&self) -> wire::PeerControls {
        wire::PeerControls {
            muted_tasks: self.peers.muted.iter().cloned().collect(),
            paused_projects: self.peers.paused.iter().cloned().collect(),
        }
    }

    pub(super) fn peers_set_muted(
        &mut self,
        task_id: &str,
        muted: bool,
    ) -> Result<wire::PeerControls, String> {
        if !self.tasks.contains_key(task_id) {
            return Err(format!("unknown task {task_id}"));
        }
        let changed = if muted {
            self.peers.muted.insert(task_id.to_string())
        } else {
            self.peers.muted.remove(task_id)
        };
        if changed {
            self.persist.write(PersistWrite::PeerControl {
                kind: PeerControl::Mute,
                key: task_id.to_string(),
                on: muted,
            });
        }
        Ok(self.peer_controls())
    }

    pub(super) fn peers_set_paused(
        &mut self,
        project: &str,
        paused: bool,
    ) -> Result<wire::PeerControls, String> {
        if self.project_path(project).is_none() {
            return Err(format!("unknown project {project}"));
        }
        let changed = if paused {
            self.peers.paused.insert(project.to_string())
        } else {
            self.peers.paused.remove(project)
        };
        if changed {
            self.persist.write(PersistWrite::PeerControl {
                kind: PeerControl::Pause,
                key: project.to_string(),
                on: paused,
            });
        }
        Ok(self.peer_controls())
    }

    /// Flush, then page the store on a worker: the read never runs on the
    /// actor loop (ADR 0002).
    pub(super) fn peers_feed(
        &self,
        project: Option<String>,
        before: Option<u64>,
        limit: Option<u32>,
        reply: oneshot::Sender<Result<Vec<wire::PeerMessage>, String>>,
    ) {
        let limit = limit.unwrap_or(FEED_PAGE).clamp(1, FEED_PAGE_MAX);
        let persist = self.persist.clone();
        let store = self.store.clone();
        tokio::spawn(async move {
            persist.flush().await;
            let result = crate::daemon::runtime::store_read(store, move |store| {
                store
                    .load_peer_messages(project.as_deref(), before, limit, None)
                    .map_err(|e| format!("{e:#}"))
            })
            .await
            .unwrap_or_else(|| Ok(Vec::new()));
            let _ = reply.send(result);
        });
    }
}
