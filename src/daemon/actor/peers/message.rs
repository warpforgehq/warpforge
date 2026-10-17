//! `session.message` (ADR 0026): the daemon resolves the target from the
//! caller's task — its own child, a visible peer, or the team channel — and
//! refuses anything else. Every peer attempt leaves a record.

use std::time::Instant;

use tokio::sync::oneshot;

use warpforge_protocol as wire;

use super::guard::{check_length, MAX_TEXT_CHARS};
use super::{HIDDEN_SELF, MUTED_SELF, PAUSED};
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::task::{now_secs, TaskStatus};

pub(crate) const TEAM: &str = "team";

type Reply = oneshot::Sender<Result<wire::PeerSendResult, String>>;

/// How an accepted direct message reaches its peer.
enum Delivery {
    /// Into the live session's queue, as its own turn.
    Queue,
    /// Kept for the digest of the peer's next prompt; it has no live session
    /// and is not woken for this.
    Hold,
}

/// A refusal's text, and whether it raises the user's alert.
pub(super) struct Refused {
    reason: String,
    alert: bool,
}

impl From<String> for Refused {
    fn from(reason: String) -> Self {
        Self {
            reason,
            alert: false,
        }
    }
}

impl From<&str> for Refused {
    fn from(reason: &str) -> Self {
        reason.to_string().into()
    }
}

impl Daemon {
    pub(super) async fn peers_message(
        &mut self,
        from: String,
        to: String,
        text: String,
        reply: Reply,
    ) {
        let Some(project) = self.tasks.get(&from).map(|task| task.project.clone()) else {
            let _ = reply.send(Err(format!("unknown task {from}")));
            return;
        };
        if to == TEAM {
            let _ = reply.send(self.peers_agent_post(&from, &project, text).await);
            return;
        }
        let child = self
            .tasks
            .get(&to)
            .is_some_and(|task| task.parent_task_id.as_deref() == Some(from.as_str()));
        if child {
            self.peers_message_child(to, text, reply).await;
            return;
        }
        let result = self.peers_direct(&from, &project, &to, text, None).await;
        let _ = reply.send(result);
    }

    /// The caller's own sub-agent gets today's follow-up: a `User` prompt,
    /// outside the guard and the feed.
    async fn peers_message_child(&mut self, to: String, text: String, reply: Reply) {
        let (tx, rx) = oneshot::channel();
        self.handle_session_command(Command::SessionPrompt {
            task_id: to,
            text,
            attachments: Vec::new(),
            initiator: crate::daemon::acp::TurnInitiator::User,
            peer_message: None,
            reply: tx,
        })
        .await;
        tokio::spawn(async move {
            let result = rx
                .await
                .unwrap_or_else(|_| Err("daemon dropped the prompt request".into()));
            let _ = reply.send(result.map(|()| wire::PeerSendResult {
                relation: wire::PeerRelation::Child,
                message: None,
                to_label: None,
                notice: None,
            }));
        });
    }

    /// @param source_id the post whose @mention this message is
    pub(super) async fn peers_direct(
        &mut self,
        from: &str,
        project: &str,
        to: &str,
        text: String,
        source_id: Option<u64>,
    ) -> Result<wire::PeerSendResult, String> {
        let addressable = to != from
            && self
                .tasks
                .get(to)
                .is_some_and(|task| task.project == project || self.peer_visible(task, project));
        if !addressable {
            return Err(format!(
                "{to} is not a session in this project; list_agents names the ones you can message"
            ));
        }
        let verdict = self.peers_admit(from, project, to, &text);
        let mut record =
            self.peers_new_record(project, Some(from), Some(to), text, verdict.as_ref().err());
        record.source_id = source_id;
        let held = matches!(verdict, Ok(Delivery::Hold));
        if held {
            record.status = wire::PeerMessageStatus::Held;
            self.peers.held.push(record.clone());
        }
        self.peers_record(&record);
        self.peers_end_alerts();
        if record.alert {
            self.peers
                .alerts
                .insert(super::guard::pair(from, to), record.clone());
        }
        if let Err(refused) = verdict {
            return Err(refused.reason);
        }
        if !held {
            self.peers_submit(&mut record).await;
        }
        self.peers_echo_sent(&record);
        let notice = (record.status == wire::PeerMessageStatus::Held).then(|| {
            format!(
                "{} is not running; it will see your message when it is next resumed.",
                self.peers_label(Some(to))
            )
        });
        Ok(wire::PeerSendResult {
            relation: wire::PeerRelation::Peer,
            message: Some(record),
            to_label: Some(self.peers_label(Some(to))),
            notice,
        })
    }

    /// The rules on the sender, shared by direct messages and posts.
    fn peers_sender_refusal(&self, from: &str, project: &str, text: &str) -> Result<(), Refused> {
        check_length(text).map_err(|refusal| refusal.to_string())?;
        if !self
            .tasks
            .get(from)
            .is_some_and(|task| self.peer_visible(task, project))
        {
            return Err(HIDDEN_SELF.into());
        }
        if self.peers.muted.contains(from) {
            return Err(MUTED_SELF.into());
        }
        if self.peers.paused.contains(project) {
            return Err(PAUSED.into());
        }
        Ok(())
    }

    fn peers_admit(
        &mut self,
        from: &str,
        project: &str,
        to: &str,
        text: &str,
    ) -> Result<Delivery, Refused> {
        self.peers_sender_refusal(from, project, text)?;
        let target = self
            .tasks
            .get(to)
            .filter(|task| self.peer_visible(task, project))
            .ok_or_else(|| {
                format!("{to} is not this session's sub-agent or a peer in its project")
            })?;
        if let Some(refusal) = self.smith_thread_refusal(to) {
            return Err(refusal.into());
        }
        if self.peers.muted.contains(to) {
            return Err(format!("the user muted peer messages for {to}").into());
        }
        if target.status == TaskStatus::Blocked {
            return Err(format!("{to} is blocked and cannot take a message").into());
        }
        let delivery = if self.sessions.contains_key(to) {
            Delivery::Queue
        } else {
            Delivery::Hold
        };
        let starts_turn = matches!(delivery, Delivery::Queue);
        self.peers
            .guard
            .admit(from, to, text, starts_turn, Instant::now())
            .map(|()| delivery)
            .map_err(|refusal| Refused {
                reason: refusal.to_string(),
                alert: refusal.alert(),
            })
    }

    /// A channel post wakes nobody (ADR 0026 invariant 3): it is recorded and
    /// rides on each peer's next prompt.
    /// @param mentions the peers the post names, which do not get it in their
    /// digest
    pub(super) fn peers_post(
        &mut self,
        from: &str,
        project: &str,
        text: String,
        mentions: Vec<String>,
    ) -> Result<wire::PeerSendResult, String> {
        let verdict = self.peers_sender_refusal(from, project, &text);
        let mut record =
            self.peers_new_record(project, Some(from), None, text, verdict.as_ref().err());
        if verdict.is_ok() {
            record.status = wire::PeerMessageStatus::Posted;
            record.mentions = mentions;
        }
        self.peers_record(&record);
        verdict.map_err(|refused| refused.reason)?;
        self.peers.remember_post(record.clone());
        self.peers_echo_sent(&record);
        Ok(wire::PeerSendResult {
            relation: wire::PeerRelation::Team,
            message: Some(record),
            to_label: None,
            notice: None,
        })
    }

    pub(super) fn peers_new_record(
        &mut self,
        project: &str,
        from: Option<&str>,
        to: Option<&str>,
        text: String,
        refused: Option<&Refused>,
    ) -> wire::PeerMessage {
        wire::PeerMessage {
            id: self.peers_next_id(),
            project: project.to_string(),
            from_task: from.map(str::to_string),
            to_task: to.map(str::to_string),
            text: text.chars().take(MAX_TEXT_CHARS).collect(),
            created_at: now_secs(),
            delivered_at: None,
            status: match refused {
                Some(_) => wire::PeerMessageStatus::Refused,
                None => wire::PeerMessageStatus::Queued,
            },
            reason: refused.map(|r| r.reason.clone()),
            alert: refused.is_some_and(|r| r.alert),
            alert_cleared_at: None,
            mentions: Vec::new(),
            source_id: None,
            started_task: None,
            channel_id: None,
        }
    }
}
