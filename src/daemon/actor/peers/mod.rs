//! Peer sessions (ADR 0026): the directory, the status note, the feed's
//! records, the loop guard, and the user's mutes and pauses. Every
//! `PeerCommand` is matched here, in one place.

mod command;
mod controls;
mod directory;
mod guard;
mod message;
#[cfg(test)]
mod tests;

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use warpforge_protocol as wire;

use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::store::{PeerControl, Store};

pub use command::PeerCommand;

pub(crate) const MUTED_SELF: &str = "the user muted this session's peer messages";
pub(crate) const PAUSED: &str = "the user paused peer messages in this project";

/// The actor's peer state. Mutes, pauses and cursors mirror the store; the
/// guard's counters live only here.
pub(crate) struct PeersState {
    next_id: u64,
    guard: guard::PeerGuard,
    /// Last channel post id each task has been given, by task id.
    cursors: HashMap<String, u64>,
    muted: BTreeSet<String>,
    paused: BTreeSet<String>,
}

/// Refuse what the previous daemon left queued, then read the peer rows once,
/// while startup still owns the connection.
/// @param store the daemon's store, when it opened
/// @returns the state the actor starts with
pub(crate) fn load_state(store: Option<&Arc<Mutex<Store>>>) -> PeersState {
    let mut state = PeersState {
        next_id: 1,
        guard: Default::default(),
        cursors: HashMap::new(),
        muted: BTreeSet::new(),
        paused: BTreeSet::new(),
    };
    let Some(Ok(store)) = store.map(|s| s.lock()) else {
        return state;
    };
    let _ = store.refuse_queued_peer_messages();
    state.next_id = store.max_peer_message_id().unwrap_or(0) + 1;
    state.cursors = store
        .load_peer_cursors()
        .unwrap_or_default()
        .into_iter()
        .collect();
    state.muted = store
        .load_peer_controls(PeerControl::Mute)
        .unwrap_or_default()
        .into_iter()
        .collect();
    state.paused = store
        .load_peer_controls(PeerControl::Pause)
        .unwrap_or_default()
        .into_iter()
        .collect();
    state
}

impl Daemon {
    pub(crate) async fn handle_peer_command(&mut self, cmd: PeerCommand) {
        match cmd {
            PeerCommand::List { task_id, reply } => {
                let _ = reply.send(self.peers_list(&task_id));
            }
            PeerCommand::Feed {
                project,
                before,
                limit,
                reply,
            } => self.peers_feed(project, before, limit, reply),
            PeerCommand::Controls { reply } => {
                let _ = reply.send(Ok(self.peer_controls()));
            }
            PeerCommand::SetMuted {
                task_id,
                muted,
                reply,
            } => {
                let _ = reply.send(self.peers_set_muted(&task_id, muted));
            }
            PeerCommand::SetPaused {
                project,
                paused,
                reply,
            } => {
                let _ = reply.send(self.peers_set_paused(&project, paused));
            }
            PeerCommand::SetStatusNote {
                task_id,
                text,
                reply,
            } => {
                let _ = reply.send(self.peers_set_status_note(&task_id, &text));
            }
            PeerCommand::Message {
                from_task_id,
                to,
                message,
                reply,
            } => self.peers_message(from_task_id, to, message, reply).await,
        }
    }

    /// A turn started in `task_id`: a `User` or `Automation` turn resets the
    /// pair windows it is in.
    /// @param task_id the task whose turn started
    /// @param initiator who asked for the turn
    pub(crate) fn peers_turn_started(&mut self, task_id: &str, initiator: TurnInitiator) {
        if matches!(initiator, TurnInitiator::User | TurnInitiator::Automation) {
            self.peers.guard.reset_for(task_id);
        }
    }

    /// Record that `task_id` was given every channel post up to `last_seen`.
    /// @param task_id the receiving task
    /// @param last_seen the newest post id its turn carried
    pub(crate) fn peers_advance_cursor(&mut self, task_id: &str, last_seen: u64) {
        self.peers.cursors.insert(task_id.to_string(), last_seen);
        self.persist.write(PersistWrite::PeerCursor {
            task_id: task_id.to_string(),
            last_seen,
        });
    }

    /// Queue a record's store write and announce it. Callers do this before
    /// anything reaches an agent (ADR 0026 invariant 2).
    fn peers_record(&mut self, record: &wire::PeerMessage) {
        self.persist
            .write(PersistWrite::PeerMessage(Box::new(record.clone())));
        self.emit(Event::PeerMessageUpdated(Box::new(record.clone())));
    }

    fn peers_next_id(&mut self) -> u64 {
        let id = self.peers.next_id;
        self.peers.next_id += 1;
        id
    }
}
