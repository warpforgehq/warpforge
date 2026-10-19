//! Peer sessions (ADR 0026): the directory entry one session sees of another,
//! and the persisted record of every message between them.

use serde::{Deserialize, Serialize};

use crate::{TaskBlockedKind, TaskStatus};

/// What a directory entry stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerKind {
    /// A top-level task session.
    Task,
    /// A Smith's thread (ADR 0027): `name` is the Smith's.
    Smith,
}

/// A session in another session's directory. Metadata only: a new field must
/// not be able to hold prompt, transcript or file text (ADR 0026 invariant 7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub id: String,
    pub kind: PeerKind,
    /// A persistent agent's name; `None` for a plain task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The task title, or the first line of its prompt when it has none.
    pub title: String,
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: TaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_kind: Option<TaskBlockedKind>,
    /// Hidden from its owner's attention; the session still works.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub snoozed: bool,
    /// The session orchestrates children of its own.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub orchestrator: bool,
    /// A session the caller started with `start_work`; it reports back to it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub started: bool,
    pub project: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    /// How many files the session changed — a hint, never the list.
    pub files_changed: u32,
    pub updated_at: u64,
    /// What the session says it is doing, set by the session itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// The one way every surface names a peer: `name · title` when it has a name,
/// otherwise its title.
/// @param peer the directory entry
/// @returns the label to show
pub fn peer_label(peer: &PeerInfo) -> String {
    match (&peer.name, peer.kind) {
        (Some(name), PeerKind::Smith) => name.clone(),
        (Some(name), PeerKind::Task) => format!("{name} · {}", peer.title),
        (None, _) => peer.title.clone(),
    }
}

/// Which side of a peer message a chat entry is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerDirection {
    Sent,
    Received,
    Digest,
}

/// Where a peer message stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerMessageStatus {
    /// Accepted, waiting for the receiver's turn to start.
    Queued,
    /// The receiver's turn started with it.
    Delivered,
    /// A channel post, accepted; peers read it with their next prompt.
    Posted,
    /// Accepted for a peer with no live session; it reads the message with
    /// its next prompt, once resumed.
    Held,
    /// Refused; `reason` names the rule.
    Refused,
}

impl PeerMessageStatus {
    /// @returns the stored spelling
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Delivered => "delivered",
            Self::Posted => "posted",
            Self::Held => "held",
            Self::Refused => "refused",
        }
    }

    /// @param value a stored spelling
    /// @returns the status, `Refused` for anything unknown
    pub fn parse(value: &str) -> Self {
        match value {
            "queued" => Self::Queued,
            "delivered" => Self::Delivered,
            "posted" => Self::Posted,
            "held" => Self::Held,
            _ => Self::Refused,
        }
    }
}

/// One attempt to message a peer or post to the team channel, refusals
/// included.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerMessage {
    /// Increases with every record, so it orders and pages the feed.
    pub id: u64,
    pub project: String,
    /// `None` when the user sent it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_task: Option<String>,
    /// `None` for a channel post.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_task: Option<String>,
    pub text: String,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<u64>,
    pub status: PeerMessageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The first refusal of a pair's message window, which the user hears
    /// about once.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub alert: bool,
    /// When the alert's window ended, by time, a `User` or `Automation` turn,
    /// a deleted task or a restart. An alert is live while this is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alert_cleared_at: Option<u64>,
    /// The sessions a post reached through its @mentions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<String>,
    /// The post this record came from: a mention's direct message, or the
    /// line recording a session started from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<u64>,
    /// The session the user started from a post; the record is that line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_task: Option<String>,
    /// The named channel a post went to; `None` is `#general`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
}

/// How the daemon resolved a `session.message` target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerRelation {
    /// The caller's own sub-agent, sent today's follow-up.
    Child,
    Peer,
    /// The project's channel.
    Team,
}

/// What `session.message` did with an accepted message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerSendResult {
    pub relation: PeerRelation,
    /// The feed record; `None` for a child, which is not peer messaging.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<PeerMessage>,
    /// The receiver's `peer_label`, for a direct message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_label: Option<String>,
    /// What the sender should know about delivery, when it is not immediate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

/// The user's persisted holds on peer messaging.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerControls {
    /// Sessions whose peer messages, posts and note are refused, as are the
    /// peer messages addressed to them.
    pub muted_tasks: Vec<String>,
    /// Projects where every agent's peer messages and posts are refused.
    pub paused_projects: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(name: Option<&str>) -> PeerInfo {
        PeerInfo {
            id: "t_a".into(),
            kind: PeerKind::Task,
            name: name.map(str::to_string),
            title: "Fix login".into(),
            agent: "claude".into(),
            model: None,
            status: TaskStatus::Running,
            blocked_kind: None,
            snoozed: false,
            orchestrator: false,
            project: "demo".into(),
            worktree: None,
            base_branch: None,
            files_changed: 0,
            updated_at: 0,
            note: None,
        }
    }

    #[test]
    fn peer_label_puts_a_name_before_the_title() {
        assert_eq!(peer_label(&peer(None)), "Fix login");
        assert_eq!(peer_label(&peer(Some("Smith"))), "Smith · Fix login");
    }

    #[test]
    fn session_message_params_keep_snake_case() {
        let method: crate::Method = serde_json::from_value(serde_json::json!({
            "method": "session.message",
            "params": { "from_task_id": "t_a", "to": "team", "message": "hi" },
        }))
        .unwrap();
        assert_eq!(
            method,
            crate::Method::SessionMessage {
                from_task_id: "t_a".into(),
                to: "team".into(),
                message: "hi".into(),
            }
        );
    }

    #[test]
    fn a_peer_chat_entry_has_its_own_kind_and_older_queue_entries_still_parse() {
        let entry = crate::SessionUpdate::PeerMessage {
            message_ids: vec![4],
            from_task: Some("t_a".into()),
            from_label: "Fix login".into(),
            to_task: None,
            to_label: None,
            text: "hi".into(),
            direction: crate::PeerDirection::Received,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["kind"], "peer_message");
        assert_eq!(json["direction"], "received");
        assert_eq!(
            serde_json::from_value::<crate::SessionUpdate>(json).unwrap(),
            entry
        );
        let queued: crate::QueuedPrompt = serde_json::from_value(serde_json::json!({
            "id": "q1", "text": "go", "initiator": "user"
        }))
        .unwrap();
        assert_eq!(queued.peer_message_id, None);
    }
}
