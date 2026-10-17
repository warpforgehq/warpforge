//! Smiths (ADR 0027): the actor's authoritative mirror of every Smith, and
//! the one exhaustive match over `SmithCommand`. Identity files are written
//! off the loop (`daemon/smiths/identity.rs`); results come back as commands.

mod command;
mod directory;
mod manage;
pub(crate) mod prompt;
#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::smiths::identity::{self, Revs};
use crate::daemon::store::Store;

pub use command::SmithCommand;

/// `origin` of a Smith's thread task.
pub(crate) const SMITH_ORIGIN: &str = "smith";

pub(crate) struct SmithsState {
    /// Where identity repos live: `~/.warpforge/smiths` outside tests.
    root: PathBuf,
    smiths: HashMap<String, wire::Smith>,
    /// Lowercased names claimed by a create still writing its repo.
    pending_names: HashSet<String>,
    /// Smiths whose identity repo has a write in flight.
    busy: HashSet<String>,
}

/// The identity revs a Smith row records.
fn recorded(smith: &wire::Smith) -> Revs {
    Revs {
        soul: smith.soul_rev.clone(),
        charter: smith.charter_rev.clone(),
    }
}

/// Read the Smiths once at startup and hold every one whose identity files
/// changed outside the daemon since it last committed them.
/// @param store the daemon's store, when it opened
/// @param root the smiths root
/// @returns the mirror the actor starts with
pub(crate) fn load_state(store: Option<&Arc<Mutex<Store>>>, root: PathBuf) -> SmithsState {
    let rows = match store.map(|s| s.lock()) {
        Some(Ok(store)) => store.load_smiths().unwrap_or_default(),
        _ => Vec::new(),
    };
    let smiths = rows
        .into_iter()
        .map(|mut smith| {
            let unchanged =
                identity::is_unchanged(&identity::repo(&root, &smith.id), &recorded(&smith));
            set_hold(&mut smith, wire::SmithHold::IdentityChanged, !unchanged);
            (smith.id.clone(), smith)
        })
        .collect();
    SmithsState {
        root,
        smiths,
        pending_names: HashSet::new(),
        busy: HashSet::new(),
    }
}

/// The root a daemon keeps identity repos in. Test builds get a fresh one
/// per daemon, so `cargo test` never touches the user's Smiths.
pub(crate) fn default_root() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join(format!(
            "wf-smiths-test-{}",
            &uuid::Uuid::new_v4().to_string()[..8]
        ))
    } else {
        crate::registry::warpforge_dir().join("smiths")
    }
}

/// Add or lift one hold, keeping the list sorted and unique.
fn set_hold(smith: &mut wire::Smith, hold: wire::SmithHold, on: bool) {
    smith.held.retain(|h| *h != hold);
    if on {
        smith.held.push(hold);
        smith.held.sort();
    }
}

impl Daemon {
    pub(crate) async fn handle_smith_command(&mut self, cmd: SmithCommand) {
        match cmd {
            SmithCommand::List { reply } => {
                let mut smiths: Vec<wire::Smith> = self.smiths.smiths.values().cloned().collect();
                smiths.sort_by_key(|smith| smith.name.to_lowercase());
                let _ = reply.send(Ok(smiths));
            }
            SmithCommand::Get { id, reply } => self.smith_get(&id, reply),
            SmithCommand::Create { create, reply } => self.smith_create(*create, reply),
            SmithCommand::Update { id, patch, reply } => self.smith_update(&id, *patch, reply),
            SmithCommand::SetPaused { id, paused, reply } => {
                let _ = reply.send(self.smith_set_paused(&id, paused));
            }
            SmithCommand::Delete { id, reply } => {
                let _ = reply.send(self.smith_delete(&id));
            }
            SmithCommand::AcceptIdentity { id, reply } => {
                self.smith_resolve_identity(&id, true, reply)
            }
            SmithCommand::RevertIdentity { id, reply } => {
                self.smith_resolve_identity(&id, false, reply)
            }
            SmithCommand::Created {
                smith,
                result,
                reply,
            } => self.smith_created(*smith, result, reply),
            SmithCommand::IdentityWritten {
                id,
                result,
                patch,
                reply,
            } => self.smith_identity_written(&id, result, patch.map(|p| *p), reply),
        }
    }

    /// Mirror first, then the store queue, then the event (ADR 0007).
    fn smith_put(&mut self, smith: wire::Smith) {
        self.persist
            .write(PersistWrite::Smith(Box::new(smith.clone())));
        self.emit(Event::SmithUpdated(Box::new(smith.clone())));
        self.smiths.smiths.insert(smith.id.clone(), smith);
    }

    /// The Smith whose thread is `task_id`.
    pub(crate) fn smith_of_thread(&self, task_id: &str) -> Option<&wire::Smith> {
        self.smiths
            .smiths
            .values()
            .find(|smith| smith.thread_task_id == task_id)
    }
}
