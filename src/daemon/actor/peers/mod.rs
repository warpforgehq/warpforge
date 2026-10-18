//! Peer sessions (ADR 0026): the directory, the status note, the feed's
//! records, the loop guard, and the user's mutes and pauses. Every
//! `PeerCommand` is matched here, in one place.

mod channels;
mod command;
mod controls;
mod conversation;
mod delivery;
mod digest;
mod directory;
mod guard;
mod mention;
mod message;
#[cfg(test)]
mod tests;
mod user;

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::store::{PeerControl, Store, StoredChannel};
use crate::daemon::task::now_secs;

pub use command::PeerCommand;
#[cfg(test)]
pub(crate) use conversation::CHANNEL_WAKES;
pub(crate) use directory::{is_peer_visible, peer_info};

pub(crate) const MUTED_SELF: &str = "the user muted this session's peer messages";
pub(crate) const PAUSED: &str = "the user paused peer messages in this project";
pub(crate) const HIDDEN_SELF: &str =
    "this session is not in the peer directory, so it cannot message peers or the team";

/// The actor's peer state. Mutes, pauses and cursors mirror the store; the
/// guard's counters live only here.
pub(crate) struct PeersState {
    next_id: u64,
    guard: guard::PeerGuard,
    /// Last channel post id each task has been given, by task id.
    cursors: HashMap<String, u64>,
    muted: BTreeSet<String>,
    paused: BTreeSet<String>,
    /// Each live alert's record, by pair, to rewrite when its window ends.
    alerts: HashMap<guard::Pair, wire::PeerMessage>,
    /// Direct messages in a live session's queue, by record id.
    in_flight: HashMap<u64, wire::PeerMessage>,
    /// Direct messages waiting for their receiver's next prompt, oldest first.
    held: Vec<wire::PeerMessage>,
    /// The newest posts per project and channel (`None` = `#general`),
    /// oldest first.
    posts: HashMap<(String, Option<String>), VecDeque<wire::PeerMessage>>,
    /// Named channels, by id.
    channels: HashMap<String, StoredChannel>,
    /// Channel turns waiting for and given to Smith threads.
    conversations: conversation::Conversations,
    /// Records already carried by a prompt whose turn has not started, per
    /// receiving task, so a second queued prompt does not repeat them.
    reserved: HashMap<String, HashSet<u64>>,
    /// Queued direct messages the user is removing from a receiver's queue.
    removing: HashSet<u64>,
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
        alerts: HashMap::new(),
        in_flight: HashMap::new(),
        held: Vec::new(),
        posts: HashMap::new(),
        channels: HashMap::new(),
        conversations: Default::default(),
        reserved: HashMap::new(),
        removing: HashSet::new(),
    };
    let Some(Ok(store)) = store.map(|s| s.lock()) else {
        return state;
    };
    let _ = store.refuse_queued_peer_messages();
    let _ = store.clear_peer_alerts(now_secs());
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
    state.channels = store
        .load_channels()
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();
    state.held = store
        .load_peer_messages_with_status(wire::PeerMessageStatus::Held)
        .unwrap_or_default();
    for post in store
        .load_recent_peer_posts(digest::POSTS_KEPT as u32)
        .unwrap_or_default()
    {
        state.remember_post(post);
    }
    state
}

impl PeersState {
    pub(super) fn remember_post(&mut self, post: wire::PeerMessage) {
        let key = (post.project.clone(), post.channel_id.clone());
        let posts = self.posts.entry(key).or_default();
        posts.push_back(post);
        while posts.len() > digest::POSTS_KEPT {
            posts.pop_front();
        }
    }
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
                channel,
                reply,
            } => self.peers_feed(project, before, limit, channel, reply),
            PeerCommand::Alerts { reply } => {
                let mut alerts: Vec<_> = self
                    .peers
                    .alerts
                    .values()
                    .chain(self.peers.conversations.alerts())
                    .cloned()
                    .collect();
                alerts.sort_by_key(|record| record.id);
                alerts.dedup_by_key(|record| record.id);
                let _ = reply.send(Ok(alerts));
            }
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
            PeerCommand::UserPost {
                project,
                text,
                channel_id,
                reply,
            } => {
                let _ = reply.send(self.peers_user_post(&project, text, channel_id).await);
            }
            PeerCommand::UserMessage {
                task_id,
                text,
                reply,
            } => {
                let _ = reply.send(self.peers_user_message(&task_id, text).await);
            }
            PeerCommand::UserStarted {
                task_id,
                source_id,
                reply,
            } => {
                let _ = reply.send(self.peers_user_started(&task_id, source_id));
            }
            PeerCommand::ChannelsList {
                project,
                task_id,
                reply,
            } => {
                let _ = reply.send(Ok(
                    self.channels_list(project.as_deref(), task_id.as_deref())
                ));
            }
            PeerCommand::ChannelsCreate {
                project,
                name,
                reply,
            } => {
                let _ = reply.send(self.channel_create(&project, &name));
            }
            PeerCommand::ChannelsRename { id, name, reply } => {
                let _ = reply.send(self.channel_rename(&id, &name));
            }
            PeerCommand::ChannelsDelete { id, reply } => {
                let _ = reply.send(self.channel_delete(&id));
            }
            PeerCommand::ChannelsSetMember {
                id,
                smith_id,
                member,
                reply,
            } => {
                let _ = reply.send(self.channel_set_member(&id, &smith_id, member));
            }
            #[cfg(test)]
            PeerCommand::PostKeys { reply } => {
                let _ = reply.send(self.peers.posts.keys().cloned().collect());
            }
            PeerCommand::Tick => {
                self.peers.guard.expire(Instant::now());
                self.peers_end_alerts();
                self.conversation_tick();
            }
        }
    }

    /// Stamp the record of every alert whose window ended and announce it,
    /// so a client can clear the attention item without a new message.
    fn peers_end_alerts(&mut self) {
        let now = now_secs();
        for pair in self.peers.guard.take_cleared() {
            if let Some(mut record) = self.peers.alerts.remove(&pair) {
                record.alert_cleared_at = Some(now);
                self.peers_record(&record);
            }
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
