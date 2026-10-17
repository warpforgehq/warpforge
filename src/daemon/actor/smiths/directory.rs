//! A Smith in the peer directory (ADR 0027): its thread is `kind: smith`,
//! named, and listed in every project it is allowed in.

use warpforge_protocol as wire;

use super::SMITH_ORIGIN;
use crate::daemon::actor::peers::{is_peer_visible, peer_info};
use crate::daemon::actor::Daemon;
use crate::daemon::task::{Task, TaskStatus};

impl Daemon {
    /// The one visibility filter (ADR 0026 invariant 1) with its Smith arm: a
    /// thread is visible in each project its Smith is allowed in; any other
    /// task, as `is_peer_visible` says, in its own project.
    /// @param task the candidate
    /// @param project the project it is seen from
    /// @returns whether it is a peer there
    pub(crate) fn peer_visible(&self, task: &Task, project: &str) -> bool {
        if task.origin.as_deref() == Some(SMITH_ORIGIN) {
            return task.status != TaskStatus::Done
                && task.settled_override != Some(true)
                && self
                    .smith_of_thread(&task.id)
                    .is_some_and(|smith| smith.allowed_projects.iter().any(|p| p == project));
        }
        is_peer_visible(task) && task.project == project
    }

    /// A task's directory entry; a thread is its Smith, by name, with no
    /// identity text (ADR 0027 invariant 11).
    /// @param task the peer
    /// @param now unix seconds
    /// @returns the entry
    pub(crate) fn peer_entry(&self, task: &Task, now: u64) -> wire::PeerInfo {
        let mut info = peer_info(task, now);
        if let Some(smith) = self.smith_of_thread(&task.id) {
            info.kind = wire::PeerKind::Smith;
            info.name = Some(smith.name.clone());
            info.title = smith.name.clone();
        }
        info
    }

    /// Why a Smith's thread will not take a message now.
    /// @param task_id the receiving task
    /// @returns the refusal, for a held Smith's thread
    pub(crate) fn smith_thread_refusal(&self, task_id: &str) -> Option<String> {
        let smith = self.smith_of_thread(task_id)?;
        let hold = smith.held.first()?;
        let why = match hold {
            wire::SmithHold::Paused => "paused",
            wire::SmithHold::IdentityChanged => "held until the user reviews an edit to it",
            wire::SmithHold::Budget => "over its budget",
        };
        Some(format!("{} is {why}", smith.name))
    }
}
