//! Getting a peer message to its receiver (ADR 0026): a direct message is a
//! `Peer` turn in the receiver's queue, and every delivery — that turn, a
//! digest's posts and held messages — is marked at `TurnStarted` only.

use std::time::Instant;

use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::prompt::PeerDelivery;
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::task::now_secs;

const DROPPED: &str = "dropped from the receiver's queue before it was delivered";
const RECEIVER_DELETED: &str = "the receiving session was deleted";

impl Daemon {
    /// Queue an accepted direct message as a `Peer` turn. A session that turns
    /// out to be gone holds the message instead.
    /// @returns whether the message was queued rather than held
    pub(super) async fn peers_submit(&mut self, record: &mut wire::PeerMessage) -> bool {
        let to = record.to_task.clone().unwrap_or_default();
        self.peers.in_flight.insert(record.id, record.clone());
        let (tx, mut rx) = oneshot::channel();
        self.handle_session_command(Command::SessionPrompt {
            task_id: to.clone(),
            text: record.text.clone(),
            attachments: Vec::new(),
            initiator: TurnInitiator::Peer,
            peer_message: Some(record.id),
            reply: tx,
        })
        .await;
        if matches!(rx.try_recv(), Ok(Ok(()))) {
            return true;
        }
        // A stale handle was dropped on the way, and `drop_session` already
        // held the record; report it as it now stands.
        if let Some(held) = self.peers.in_flight.remove(&record.id) {
            self.peers_hold(held);
        }
        if let Some(held) = self.peers.held.iter().find(|m| m.id == record.id) {
            *record = held.clone();
        }
        false
    }

    /// A turn started in `task_id`: mark what it delivers, write the
    /// receiver's chat entries, and let a `User` or `Automation` turn reset
    /// the pair windows the task is in.
    /// @param task_id the task whose turn started
    /// @param initiator who asked for the turn
    /// @param delivery the peer messages the turn carries
    pub(crate) fn peers_turn_started(
        &mut self,
        task_id: &str,
        initiator: TurnInitiator,
        delivery: PeerDelivery,
    ) {
        if matches!(initiator, TurnInitiator::User | TurnInitiator::Automation) {
            self.peers.guard.reset_for(task_id);
            self.peers_end_alerts();
        }
        let now = now_secs();
        let instant = Instant::now();
        if let Some(mut record) = delivery
            .direct
            .and_then(|id| self.peers.in_flight.remove(&id))
        {
            self.peers.removing.remove(&record.id);
            if let Some(from) = record.from_task.as_deref() {
                self.peers.guard.release(from, task_id);
            }
            self.peers.guard.note_delivered(task_id, instant);
            record.status = wire::PeerMessageStatus::Delivered;
            record.delivered_at = Some(now);
            self.peers_record(&record);
        }
        for id in &delivery.held {
            let Some(index) = self.peers.held.iter().position(|m| m.id == *id) else {
                continue;
            };
            let mut record = self.peers.held.remove(index);
            record.status = wire::PeerMessageStatus::Delivered;
            record.delivered_at = Some(now);
            self.peers_record(&record);
        }
        if let Some(cursor) = delivery.cursor {
            if self
                .peers
                .cursors
                .get(task_id)
                .is_none_or(|seen| *seen < cursor)
            {
                self.peers_advance_cursor(task_id, cursor);
            }
        }
        if let Some(reserved) = self.peers.reserved.get_mut(task_id) {
            let cursor = delivery.cursor.unwrap_or(0);
            reserved.retain(|id| *id > cursor && !delivery.held.contains(id));
        }
        for entry in delivery.transcript {
            self.emit_session(task_id, entry);
        }
    }

    /// The receiver's queue changed: a direct message that left it without
    /// its turn starting was removed by the user — refused — or lost with the
    /// session or its transport — held for the next prompt.
    /// @param task_id the receiving task
    /// @param queued what is still waiting
    pub(crate) fn peers_queue_changed(&mut self, task_id: &str, queued: &[wire::QueuedPrompt]) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let gone: Vec<u64> = task
            .queued_prompts
            .iter()
            .filter_map(|q| q.peer_message_id)
            .filter(|id| !queued.iter().any(|q| q.peer_message_id == Some(*id)))
            .collect();
        for id in gone {
            let removed = self.peers.removing.remove(&id);
            let Some(mut record) = self.peers.in_flight.remove(&id) else {
                continue;
            };
            if !removed {
                self.peers_hold(record);
                continue;
            }
            if let Some(from) = record.from_task.as_deref() {
                self.peers.guard.release(from, task_id);
            }
            record.status = wire::PeerMessageStatus::Refused;
            record.reason = Some(DROPPED.into());
            self.peers_record(&record);
        }
    }

    /// The user is removing a waiting message; if it is a peer's, its record
    /// is refused when it leaves the queue.
    /// @param task_id the receiving task
    /// @param queued_id the queue entry
    pub(crate) fn peers_removing(&mut self, task_id: &str, queued_id: &str) {
        let id = self
            .tasks
            .get(task_id)
            .and_then(|task| task.queued_prompts.iter().find(|q| q.id == queued_id))
            .and_then(|q| q.peer_message_id);
        if let Some(id) = id {
            self.peers.removing.insert(id);
        }
    }

    /// Keep an accepted direct message for its receiver's next prompt, and
    /// free the sender's slot: it waits in no session queue now.
    /// @returns the record as held
    fn peers_hold(&mut self, mut record: wire::PeerMessage) -> wire::PeerMessage {
        if let (Some(from), Some(to)) = (record.from_task.as_deref(), record.to_task.as_deref()) {
            self.peers.guard.release(from, to);
        }
        record.status = wire::PeerMessageStatus::Held;
        self.peers.held.push(record.clone());
        self.peers_record(&record);
        record
    }

    /// A turn ended with nothing left waiting: any reservation is for a
    /// prompt that will never start, so the records are free for the next.
    /// @param task_id the task whose turn ended
    pub(crate) fn peers_turn_ended(&mut self, task_id: &str) {
        let idle = self
            .tasks
            .get(task_id)
            .is_none_or(|task| task.queued_prompts.is_empty());
        if idle {
            self.peers.reserved.remove(task_id);
        }
    }

    /// The one reconciliation for a session that is gone or never started:
    /// direct messages in its queue are held (it can be resumed), their
    /// senders' slots freed, and digest reservations dropped.
    /// @param task_id the task whose session went away
    pub(crate) fn peers_session_gone(&mut self, task_id: &str) {
        self.peers.reserved.remove(task_id);
        let lost: Vec<u64> = self
            .peers
            .in_flight
            .values()
            .filter(|m| m.to_task.as_deref() == Some(task_id))
            .map(|m| m.id)
            .collect();
        for id in lost {
            self.peers.removing.remove(&id);
            if let Some(record) = self.peers.in_flight.remove(&id) {
                self.peers_hold(record);
            }
        }
    }

    /// Drop a deleted task's cursor, mute and counters, and refuse what was
    /// held for it; its records stay.
    /// @param task_id the deleted task
    pub(crate) fn peers_task_deleted(&mut self, task_id: &str) {
        self.peers.cursors.remove(task_id);
        self.peers.muted.remove(task_id);
        self.peers.reserved.remove(task_id);
        self.peers.guard.forget(task_id);
        self.peers_end_alerts();
        let (orphans, held): (Vec<_>, Vec<_>) = std::mem::take(&mut self.peers.held)
            .into_iter()
            .partition(|m| m.to_task.as_deref() == Some(task_id));
        self.peers.held = held;
        for mut record in orphans {
            record.status = wire::PeerMessageStatus::Refused;
            record.reason = Some(RECEIVER_DELETED.into());
            self.peers_record(&record);
        }
        self.persist
            .write(PersistWrite::PeerForgetTask(task_id.to_string()));
    }

    /// The sender's chat entry for a message routing accepted.
    pub(super) fn peers_echo_sent(&mut self, record: &wire::PeerMessage) {
        let Some(from) = record.from_task.clone() else {
            return;
        };
        let to_label = Some(match record.to_task.as_deref() {
            Some(to) => self.peers_label(Some(to)),
            None => super::message::TEAM.to_string(),
        });
        let entry = wire::SessionUpdate::PeerMessage {
            message_ids: vec![record.id],
            from_label: self.peers_label(Some(&from)),
            from_task: Some(from.clone()),
            to_task: record.to_task.clone(),
            to_label,
            text: record.text.clone(),
            direction: wire::PeerDirection::Sent,
        };
        self.emit_session(&from, entry);
    }
}
