//! Channel conversations (ADR 0026 addendum, 2026-10-18): a named channel's
//! posts wake its Smith members, one coalesced turn per thread at a time, and
//! a channel turn's final message is posted back as the thread's reply.

mod cap;
mod prompt;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::sync::oneshot;
use warpforge_protocol as wire;

use super::guard::{pair, MAX_TEXT_CHARS};
use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::task::{now_secs, TaskStatus};

#[cfg(test)]
pub(crate) use cap::CHANNEL_WAKES;

/// The literal a Smith answers a channel turn with when it has nothing to add.
pub(crate) const NOTHING_TO_ADD: &str = "NOTHING_TO_ADD";
/// How long a submitted channel turn may wait to start before it is given up.
const START_TTL: Duration = Duration::from_secs(30 * 60);

/// Posts in one channel waiting for one thread.
struct Waiting {
    channel_id: String,
    posts: Vec<u64>,
    /// A user post is among them, so the turn is the user's.
    user: bool,
}

/// The channel turn a thread was given and has not finished.
pub(crate) struct ChannelTurn {
    pub(crate) channel_id: String,
    project: String,
    /// The newest post its prompt showed.
    pub(crate) newest: u64,
    started: bool,
    /// Set while the prompt is being handed to the session: a stale handle
    /// dropped on the way is not this turn's end.
    submitting: bool,
    submitted_at: Instant,
}

#[derive(Default)]
pub(crate) struct Conversations {
    /// Channels with posts waiting, per thread, oldest first.
    waiting: HashMap<String, Vec<Waiting>>,
    /// The channel turn each thread has pending or running, by thread.
    turns: HashMap<String, ChannelTurn>,
    caps: cap::ChannelCaps,
    /// Each channel's live cap alert: the post that tripped it.
    alerts: HashMap<String, wire::PeerMessage>,
}

impl Conversations {
    /// @param task_id a thread
    /// @returns the channel turn it was given and has not started
    pub(crate) fn unstarted(&self, task_id: &str) -> Option<&ChannelTurn> {
        self.turns.get(task_id).filter(|turn| !turn.started)
    }

    /// @param channel_id a channel
    /// @returns the threads on a channel turn of it
    pub(crate) fn working_in(&self, channel_id: &str) -> Vec<String> {
        let mut threads: Vec<String> = self
            .turns
            .iter()
            .filter(|(_, turn)| turn.started && turn.channel_id == channel_id)
            .map(|(thread, _)| thread.clone())
            .collect();
        threads.sort();
        threads
    }

    /// @returns the live cap alerts
    pub(crate) fn alerts(&self) -> impl Iterator<Item = &wire::PeerMessage> {
        self.alerts.values()
    }

    fn enqueue(&mut self, thread: &str, channel_id: &str, post: u64, user: bool) {
        let waiting = self.waiting.entry(thread.to_string()).or_default();
        match waiting.iter_mut().find(|w| w.channel_id == channel_id) {
            Some(entry) => {
                entry.posts.push(post);
                entry.user |= user;
            }
            None => waiting.push(Waiting {
                channel_id: channel_id.to_string(),
                posts: vec![post],
                user,
            }),
        }
    }

    fn is_waiting(&self, thread: &str, channel_id: &str) -> bool {
        self.waiting
            .get(thread)
            .is_some_and(|w| w.iter().any(|w| w.channel_id == channel_id))
    }
}

impl Daemon {
    /// The threads of a named channel's Smith members, its author left out.
    /// @param channel_id the channel
    /// @param author the posting task, `None` for the user
    /// @returns the member threads
    pub(crate) fn conversation_members(
        &self,
        channel_id: &str,
        author: Option<&str>,
    ) -> Vec<String> {
        let Some(channel) = self.peers.channels.get(channel_id) else {
            return Vec::new();
        };
        channel
            .members
            .iter()
            .filter_map(|id| self.smiths_get(id))
            .filter(|smith| smith.allowed_projects.contains(&channel.project))
            .map(|smith| smith.thread_task_id)
            .filter(|thread| Some(thread.as_str()) != author)
            .filter(|thread| {
                self.tasks
                    .get(thread)
                    .is_some_and(|task| task.status != TaskStatus::Done)
            })
            .collect()
    }

    /// Wake the Smith members of `post`'s named channel (invariants 22, 25).
    /// A user post wakes every member and resets the channel's cap; an
    /// agent's passes the cap and the pair guard per member.
    /// @param post the recorded post; its alert is set when a limit tripped
    pub(super) async fn conversation_wake(&mut self, post: &mut wire::PeerMessage) {
        let Some(channel_id) = post.channel_id.clone() else {
            return;
        };
        let author = post.from_task.clone();
        let user = author.is_none();
        if user {
            self.peers.conversations.caps.reset(&channel_id);
            self.conversation_end_alert(&channel_id);
        }
        let now = Instant::now();
        let mut woken = Vec::new();
        let mut cap_alert = None;
        let mut pair_alerts = Vec::new();
        for thread in self.conversation_members(&channel_id, author.as_deref()) {
            if self.smith_thread_refusal(&thread).is_some() {
                continue;
            }
            if let Some(from) = author.as_deref() {
                if self.peers.muted.contains(&thread) || self.peers.paused.contains(&post.project) {
                    continue;
                }
                if !self.peers.conversations.is_waiting(&thread, &channel_id) {
                    if let Err(reached) = self.peers.conversations.caps.check(&channel_id, now) {
                        if reached.alert {
                            cap_alert = Some(reached.to_string());
                        }
                        continue;
                    }
                    if let Err(refusal) = self
                        .peers
                        .guard
                        .admit(from, &thread, &post.text, false, now)
                    {
                        if refusal.alert() {
                            pair_alerts.push((pair(from, &thread), refusal.to_string()));
                        }
                        continue;
                    }
                    self.peers.conversations.caps.count(&channel_id, now);
                }
            }
            self.peers
                .conversations
                .enqueue(&thread, &channel_id, post.id, user);
            woken.push(thread);
        }
        if cap_alert.is_some() || !pair_alerts.is_empty() {
            post.alert = true;
            post.reason = cap_alert
                .clone()
                .or_else(|| pair_alerts.first().map(|(_, reason)| reason.clone()));
            self.peers_record(post);
            if cap_alert.is_some() {
                self.peers
                    .conversations
                    .alerts
                    .insert(channel_id.clone(), post.clone());
            }
            for (key, _) in pair_alerts {
                self.peers.alerts.insert(key, post.clone());
            }
        }
        for thread in woken {
            self.conversation_dispatch(&thread).await;
        }
    }

    /// Give an idle thread one turn for the oldest channel waiting for it
    /// (invariant 23). A busy thread is tried again when its turn ends.
    /// @param thread the Smith's thread
    pub(crate) async fn conversation_dispatch(&mut self, thread: &str) {
        if self.peers.conversations.turns.contains_key(thread) {
            return;
        }
        let busy = self.tasks.get(thread).is_none_or(|task| {
            task.status == TaskStatus::Running || !task.queued_prompts.is_empty()
        }) || self.pending_resume.contains_key(thread);
        if busy {
            return;
        }
        // A channel deleted, or left, since its posts arrived is skipped.
        let (waiting, channel) = loop {
            let Some(waiting) = self.conversation_next(thread) else {
                return;
            };
            let member = self
                .conversation_members(&waiting.channel_id, None)
                .iter()
                .any(|member| member == thread);
            if let Some(channel) = self.peers.channels.get(&waiting.channel_id) {
                if member {
                    break (waiting, channel.clone());
                }
            }
        };
        let (text, newest) = self.conversation_prompt(thread, &channel, &waiting.posts);
        let initiator = if waiting.user {
            TurnInitiator::User
        } else if self.sessions.contains_key(thread) {
            TurnInitiator::Peer
        } else {
            // A peer's prompt never resumes a session; a channel turn must.
            TurnInitiator::System
        };
        self.peers.conversations.turns.insert(
            thread.to_string(),
            ChannelTurn {
                channel_id: channel.id.clone(),
                project: channel.project.clone(),
                newest,
                started: false,
                submitting: true,
                submitted_at: Instant::now(),
            },
        );
        let (tx, mut rx) = oneshot::channel();
        self.handle_session_command(Command::SessionPrompt {
            task_id: thread.to_string(),
            text,
            attachments: Vec::new(),
            initiator,
            peer_message: None,
            reply: tx,
        })
        .await;
        if let Ok(Err(error)) = rx.try_recv() {
            eprintln!("[daemon] channel turn for {thread}: {error}");
            self.peers.conversations.turns.remove(thread);
            return;
        }
        // A start that failed or was refused on the way leaves no session and
        // no resume behind: that turn will never start, so it must not wait.
        let started =
            self.sessions.contains_key(thread) || self.pending_resume.contains_key(thread);
        let blocked = self
            .tasks
            .get(thread)
            .is_none_or(|task| task.status == TaskStatus::Blocked);
        if blocked || !started {
            self.peers.conversations.turns.remove(thread);
            return;
        }
        if let Some(turn) = self.peers.conversations.turns.get_mut(thread) {
            turn.submitting = false;
        }
    }

    fn conversation_next(&mut self, thread: &str) -> Option<Waiting> {
        let waiting = self.peers.conversations.waiting.get_mut(thread)?;
        let next = (!waiting.is_empty()).then(|| waiting.remove(0));
        if waiting.is_empty() {
            self.peers.conversations.waiting.remove(thread);
        }
        next
    }

    /// The thread's turn started; dispatch waits for an idle thread, so the
    /// first turn to start after it is the channel turn.
    /// @param task_id the task whose turn started
    pub(crate) fn conversation_turn_started(&mut self, task_id: &str) {
        let Some(turn) = self.peers.conversations.turns.get_mut(task_id) else {
            return;
        };
        if turn.started {
            return;
        }
        turn.started = true;
        let channel_id = turn.channel_id.clone();
        self.channel_announce(&channel_id);
    }

    /// The thread's turn ended: a clean channel turn's closing text becomes
    /// its post (invariant 24), then the next waiting channel goes out.
    /// @param task_id the task whose turn ended
    /// @param interrupted whether the turn was cut short
    pub(crate) async fn conversation_turn_ended(&mut self, task_id: &str, interrupted: bool) {
        let started = self
            .peers
            .conversations
            .turns
            .get(task_id)
            .map(|turn| turn.started);
        if started == Some(false) {
            // A channel turn that ended without starting never will; holding
            // its entry would keep the thread from every later channel turn.
            self.peers.conversations.turns.remove(task_id);
            self.conversation_dispatch(task_id).await;
            return;
        }
        if let Some(turn) = self.peers.conversations.turns.remove(task_id) {
            self.channel_announce(&turn.channel_id);
            let closing = self.collect_stage_text(task_id).closing;
            let reply = closing.trim();
            let open = self.peers.channels.contains_key(&turn.channel_id);
            if open && !interrupted && !reply.is_empty() && reply != NOTHING_TO_ADD {
                let text: String = reply.chars().take(MAX_TEXT_CHARS).collect();
                let posted = self
                    .peers_agent_post(task_id, &turn.project, text, Some(turn.channel_id))
                    .await;
                if let Err(error) = posted {
                    eprintln!("[daemon] channel reply from {task_id}: {error}");
                }
            }
        }
        self.conversation_dispatch(task_id).await;
    }

    /// The thread's session went away: a channel turn it had is lost, and
    /// its posts stay for the next one.
    /// @param task_id the task whose session is gone
    pub(crate) fn conversation_session_gone(&mut self, task_id: &str) {
        let lost = self
            .peers
            .conversations
            .turns
            .get(task_id)
            .is_some_and(|turn| !turn.submitting);
        if lost {
            if let Some(turn) = self.peers.conversations.turns.remove(task_id) {
                self.channel_announce(&turn.channel_id);
            }
        }
    }

    /// Drop a deleted task's waiting channels and turn.
    /// @param task_id the deleted task
    pub(crate) fn conversation_task_deleted(&mut self, task_id: &str) {
        self.peers.conversations.waiting.remove(task_id);
        self.peers.conversations.turns.remove(task_id);
    }

    /// The minute tick: give up channel turns that never started, and end
    /// cap alerts whose window has room again.
    pub(crate) fn conversation_tick(&mut self) {
        let now = Instant::now();
        self.peers
            .conversations
            .turns
            .retain(|_, turn| turn.started || now.duration_since(turn.submitted_at) < START_TTL);
        for channel_id in self.peers.conversations.caps.expire(now) {
            self.conversation_end_alert(&channel_id);
        }
    }

    fn conversation_end_alert(&mut self, channel_id: &str) {
        if let Some(mut record) = self.peers.conversations.alerts.remove(channel_id) {
            record.alert_cleared_at = Some(now_secs());
            self.peers_record(&record);
        }
    }

    /// Re-announce a channel so clients see who is working in it.
    fn channel_announce(&mut self, channel_id: &str) {
        if let Some(channel) = self.peers.channels.get(channel_id).cloned() {
            let view = self.channel_view(&channel);
            self.emit(Event::ChannelUpdated(Box::new(view)));
        }
    }
}
