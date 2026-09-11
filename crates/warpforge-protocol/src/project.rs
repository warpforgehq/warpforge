//! Projects and the daemon itself: bootstrap answers, worktrees, external
//! sessions and the daemon endpoint clients connect to.

use serde::{Deserialize, Serialize};

/// Answers collected by the desktop bootstrap wizard. Mirrors the daemon's
/// `bootstrap::UserRuntimeAnswers`; `runtime_kind` is one of `local`,
/// `docker-compose`, `kubernetes`, `mixed`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapAnswers {
    pub agent: String,
    pub runtime_kind: String,
    #[serde(default)]
    pub compose_path: String,
    #[serde(default)]
    pub k8s_manifests_path: String,
    #[serde(default)]
    pub k8s_helm_file: String,
    #[serde(default)]
    pub k8s_release_names: String,
    #[serde(default)]
    pub k8s_namespace: String,
    #[serde(default)]
    pub dev_commands: String,
    #[serde(default)]
    pub notes: String,
}

/// A git worktree for an isolated task.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub task_id: String,
    pub path: String,
    pub branch: String,
    pub base_branch: String,
}

/// An agent session discovered on disk (claude/codex native session store),
/// resumable via `task.resume` → ACP `session/load`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSession {
    /// Agent id this session belongs to ("claude" | "codex").
    pub agent: String,
    /// The agent's native session id (uuid) — passed to ACP `session/load`.
    pub session_id: String,
    /// Human-readable title (first user prompt or codex thread name); may be empty.
    pub title: String,
    /// Unix seconds of last activity (file mtime / index timestamp).
    pub updated_at: u64,
    /// Rough message count (0 if unknown).
    pub message_count: u32,
}

/// Contents of `~/.warpforge/daemon.json`, written by the daemon on startup
/// so clients can discover the endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonEndpoint {
    pub pid: u32,
    /// e.g. "ws://127.0.0.1:61814"
    pub url: String,
    /// Random per-daemon-start token; clients send it as the first frame:
    /// `{ "auth": "<token>" }`.
    pub token: String,
    pub version: String,
    #[serde(default)]
    pub protocol_version: u32,
    #[serde(default)]
    pub owner: DaemonOwner,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DaemonOwner {
    Desktop,
    #[default]
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHandshake {
    pub daemon_version: String,
    pub protocol_version: u32,
    pub owner: DaemonOwner,
    pub protocol_compatible: bool,
    pub exact_version_match: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHandoff {
    pub ready: bool,
    #[serde(default)]
    pub blockers: Vec<String>,
}
