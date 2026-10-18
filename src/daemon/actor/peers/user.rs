//! The user on the team (ADR 0026): posts, direct messages and "started from
//! a post" lines sent from the Team view. The user's messages are `User`
//! prompts with a feed record; mute and pause never apply to them.

use tokio::sync::oneshot;
use tokio::sync::oneshot::error::TryRecvError;

use warpforge_protocol as wire;

use super::guard::check_length;
use super::mention::resolve_mentions;
use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::task::now_secs;

impl Daemon {
    pub(super) async fn peers_user_post(
        &mut self,
        project: &str,
        text: String,
        channel: Option<String>,
    ) -> Result<wire::PeerSendResult, String> {
        check_length(&text).map_err(|refusal| refusal.to_string())?;
        if self.project_path(project).is_none() {
            return Err(format!("unknown project {project}"));
        }
        if let Some(id) = channel.as_deref() {
            let known = self
                .peers
                .channels
                .get(id)
                .is_some_and(|c| c.project == project);
            if !known {
                return Err(format!("no channel {id} in {project}"));
            }
        }
        let candidates = self.peers_mention_candidates(project, None);
        let mentions = resolve_mentions(&text, &candidates)?;
        let mut record = self.peers_new_record(project, None, None, text.clone(), None);
        record.status = wire::PeerMessageStatus::Posted;
        record.mentions = mentions.clone();
        record.channel_id = channel;
        self.peers_record(&record);
        self.peers.remember_post(record.clone());
        let woken = match record.channel_id.as_deref() {
            Some(id) => self.conversation_members(id, None),
            None => Vec::new(),
        };

        let mut reached = Vec::new();
        let mut notices = Vec::new();
        for to in mentions {
            if woken.contains(&to) {
                reached.push(to);
                continue;
            }
            match self.peers_user_prompt(&to, &text).await {
                Ok(()) => reached.push(to),
                Err(error) => notices.push(format!("@{}: {error}", self.peers_label(Some(&to)))),
            }
        }
        self.peers_set_mentions(&mut record, reached);
        self.conversation_wake(&mut record).await;
        Ok(wire::PeerSendResult {
            relation: wire::PeerRelation::Team,
            message: Some(record),
            to_label: None,
            notice: (!notices.is_empty()).then(|| notices.join("\n")),
        })
    }

    pub(super) async fn peers_user_message(
        &mut self,
        task_id: &str,
        text: String,
    ) -> Result<wire::PeerSendResult, String> {
        check_length(&text).map_err(|refusal| refusal.to_string())?;
        let Some(project) = self.tasks.get(task_id).map(|task| task.project.clone()) else {
            return Err(format!("unknown task {task_id}"));
        };
        let mut record = self.peers_new_record(&project, None, Some(task_id), text.clone(), None);
        self.peers_record(&record);
        let accepted = self.peers_user_prompt(task_id, &text).await;
        match &accepted {
            Ok(()) => {
                record.status = wire::PeerMessageStatus::Delivered;
                record.delivered_at = Some(now_secs());
            }
            Err(error) => {
                record.status = wire::PeerMessageStatus::Refused;
                record.reason = Some(error.clone());
            }
        }
        self.peers_record(&record);
        let to_label = self.peers_label(Some(task_id));
        accepted.map(|()| wire::PeerSendResult {
            relation: wire::PeerRelation::Peer,
            message: Some(record),
            to_label: Some(to_label),
            notice: None,
        })
    }

    pub(super) fn peers_user_started(
        &mut self,
        task_id: &str,
        source_id: Option<u64>,
    ) -> Result<wire::PeerMessage, String> {
        let Some(project) = self.tasks.get(task_id).map(|task| task.project.clone()) else {
            return Err(format!("unknown task {task_id}"));
        };
        let title = self.peers_label(Some(task_id));
        let mut record = self.peers_new_record(&project, None, None, title, None);
        record.status = wire::PeerMessageStatus::Posted;
        record.started_task = Some(task_id.to_string());
        record.source_id = source_id;
        // Not remembered as a post: the line is for the user, never a digest.
        self.peers_record(&record);
        Ok(record)
    }

    /// The chat's own prompt path. A session that has to resume first answers
    /// later; the prompt is with it by then, so that counts as accepted.
    async fn peers_user_prompt(&mut self, task_id: &str, text: &str) -> Result<(), String> {
        let (tx, mut rx) = oneshot::channel();
        self.handle_session_command(Command::SessionPrompt {
            task_id: task_id.to_string(),
            text: text.to_string(),
            attachments: Vec::new(),
            initiator: TurnInitiator::User,
            peer_message: None,
            reply: tx,
        })
        .await;
        match rx.try_recv() {
            Ok(result) => result,
            Err(TryRecvError::Empty) => Ok(()),
            Err(TryRecvError::Closed) => Err("daemon dropped the prompt request".into()),
        }
    }
}
