//! Tasks and their agent sessions: task rows, session updates, prompts,
//! plans, tool calls and the usage numbers a session reports.

use crate::{
    ConfigOption, OrchGraphInfo, WorkflowEventAgent, WorkflowEventKind, WorkflowEventTone,
    WorkflowRunInfo, WorkflowStage,
};
use serde::{Deserialize, Serialize};

/// A task on the board: one agent session working on one prompt in one project.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: String,
    pub project: String,
    pub prompt: String,
    pub agent: String,
    pub status: TaskStatus,
    pub tags: Vec<String>,
    /// Short imperative label derived from the prompt, or set explicitly. May
    /// be empty when no title has been generated or set yet.
    #[serde(default)]
    pub title: String,
    /// Unix seconds.
    pub created_at: u64,
    pub updated_at: u64,
    /// Files touched so far (drives the board card's diff badge).
    pub files_changed: u32,
    /// Set when status == Blocked or Failed.
    pub blocked_reason: Option<String>,
    /// Classification of `blocked_reason`, when the daemon recognised the
    /// failure well enough for the client to offer a way out.
    #[serde(default)]
    pub blocked_kind: Option<TaskBlockedKind>,
    /// Session selectors (model/mode/…) reported by the agent. The daemon
    /// persists the last known set so resumed/interrupted tasks can still show
    /// their controls after a restart.
    #[serde(default)]
    pub config_options: Vec<ConfigOption>,
    /// Path to the git worktree for this task, if isolated.
    /// `null` / omitted when the task runs in the project's main working dir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<String>,
    /// Orchestration graph for parent orchestrator tasks. Contains child nodes
    /// (workers/reviewers) each with their own task_id for navigation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orchestration_graph: Option<OrchGraphInfo>,
    /// Task that spawned this task through the orchestrator MCP. Keeping this
    /// on the wire lets clients present the child in its parent's context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    /// Live workflow pipeline state for workflow parent tasks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_run: Option<WorkflowRunInfo>,
    /// Explicit settle override (true = settled, false = not settled).
    /// `None` = derive from execution status only (no manual override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settled_override: Option<bool>,
    /// Unix seconds when the task was last settled. `None` = never settled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<u64>,
    /// Unix seconds until which the task is snoozed (hidden from attention).
    /// `None` = not snoozed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snoozed_until: Option<u64>,
    /// Unix seconds when the current snooze was set. `None` = not snoozed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snoozed_at: Option<u64>,
    /// Id of the backlog item this task was started from, if any. Lets clients
    /// keep the board's backlog item and its agent task linked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backlog_item_id: Option<String>,
    /// What created this task, when it is not the board — `pr-review` for the
    /// shadow task behind a pull request's Assistant tab. Clients filter their
    /// board/sidebar/backlog lists on it, so a surface-owned task never shows
    /// up as ordinary work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// True while a permission prompt for this task is unanswered. Computed
    /// daemon-side at snapshot time so clients can badge "needs you" without
    /// holding any transcript (see `docs/adr/0005`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pending_permission: bool,
}

/// A task's lifecycle. Deliberately **not** an axis for derived facts: whether
/// a `Waiting` task has a diff worth looking at is `files_changed > 0`, which is
/// already its own field. Splitting that out into a status is what turned the
/// old `NeedsReview` into a settling tank that every finished task fell into.
///
/// `Interrupted` covers sessions whose live ACP handle was lost to a daemon
/// restart. If the task has a saved native session id and the agent supports
/// `session/load`, the daemon can reconnect when the user continues.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Created; the agent has not started.
    Queued,
    /// The agent is actively working.
    Running,
    /// The agent yielded its turn and the ball is in the human's court. Merges
    /// the former `Idle` and `NeedsReview`, which named one lifecycle state
    /// twice. Both legacy strings still deserialize into this variant.
    #[serde(alias = "idle", alias = "needs_review")]
    Waiting,
    /// The agent is genuinely stuck and needs a decision or a permission grant.
    Blocked,
    /// The run was cut short (user stop / workflow stop); the work is
    /// incomplete. Distinct from `Waiting`, where the agent chose to yield.
    Interrupted,
    /// Finished or archived.
    Done,
}

/// Structured agent-session update, a deliberately small projection of ACP's
/// `session/update` notification. Extend as views need more.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageCost {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionUpdate {
    /// The developer's own prompt, echoed by the daemon into the stream so
    /// every attached client shows the same conversation.
    UserMessage {
        text: String,
        #[serde(default)]
        attachments: Vec<PromptAttachmentSummary>,
    },
    PromptCapabilities {
        image: bool,
        embedded_context: bool,
    },
    AgentText {
        text: String,
    },
    /// A durable, independently rendered entry in a workflow parent's
    /// Conversation timeline. Unlike streamed AgentText chunks these records
    /// never coalesce, and agent references remain clickable after completion.
    WorkflowEvent {
        event: WorkflowEventKind,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stage: Option<WorkflowStage>,
        #[serde(default)]
        agents: Vec<WorkflowEventAgent>,
        tone: WorkflowEventTone,
    },
    AgentThought {
        text: String,
    },
    ToolCall {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        /// Unix epoch milliseconds when the daemon first observed this call.
        /// Optional for histories written by older Warpforge versions.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        started_at: Option<u64>,
        /// ACP tool kind: read/edit/delete/move/search/execute/think/fetch/other.
        #[serde(default)]
        tool_kind: String,
        /// Rendered tool output/content, if the agent included any.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
    },
    FileEdit {
        path: String,
        /// ACP tool-call id, used by clients to coalesce lifecycle frames for
        /// the same edit. Optional for histories written by older versions.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        /// Line-level changes reported by this individual edit operation.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        additions: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deletions: Option<u32>,
        /// Compact per-operation hunks derived from ACP's oldText/newText.
        /// Older histories and lower-fidelity agents may not include them.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        hunks: Vec<EditHunk>,
    },
    PermissionRequest {
        request_id: String,
        title: String,
        options: Vec<String>,
        /// The tool call this prompt is gating, when the agent named one, so
        /// the UI can ask for the permission on the tool's own row instead of
        /// as a second card next to it. Optional: histories recorded before
        /// this existed carry no id, and an agent may ask about something that
        /// is not a tool call at all.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
    },
    /// A permission request the developer answered — recorded in the stream so
    /// the resolved state survives reopen/restart (the request itself lingers).
    PermissionResolved {
        request_id: String,
        outcome: String,
    },
    /// The agent's plan / todo list (ACP `plan` update).
    Plan {
        entries: Vec<PlanEntry>,
    },
    /// Slash-commands the agent exposes (ACP `available_commands_update`).
    AvailableCommands {
        commands: Vec<CommandInfo>,
    },
    /// Current ACP context-window utilization and optional cumulative cost.
    Usage {
        used: u64,
        size: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<SessionUsageCost>,
    },
    TurnEnded {
        stop_reason: String,
    },
}

/// One concrete edit operation reported by ACP. Unlike `Hunk`, this is scoped
/// to one tool call rather than the aggregate working-tree diff against HEAD.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Only changed lines, prefixed with '+' or '-'.
    pub lines: Vec<String>,
}

/// 1-based, inclusive source line span.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

/// A transient attachment sent with a prompt. Image data is never persisted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PromptAttachment {
    File {
        path: String,
        /// When present, only the inclusive line span is attached as context.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range: Option<LineRange>,
    },
    Image {
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        data: String,
    },
    /// A text file uploaded inline with the prompt (never persisted). Distinct
    /// from `File`, which references a path inside the task worktree.
    Document {
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        /// UTF-8 file contents. Binary uploads are rejected on both the client
        /// and the daemon, so this is plain text rather than base64.
        text: String,
    },
}

/// Safe, persistence-friendly attachment metadata stored in the transcript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PromptAttachmentSummary {
    File { path: String },
    Image { name: String },
    Document { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    /// "pending" | "in_progress" | "completed".
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

/// A machine-readable reason a task is blocked, for the cases where the client
/// can offer a way out instead of only showing the agent's message.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskBlockedKind {
    /// The agent no longer has the saved session, so it can never be resumed —
    /// its native history was deleted or expired. The conversation Warpforge
    /// stored is unaffected, so the work can continue in a fresh session.
    SessionLost,
    ModelMismatch,
}

/// Which kind of git prose `text.generate` should produce.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextGenKind {
    /// A conventional-commit message for the working-tree changes.
    CommitMessage,
    /// A pull-request title + body for the branch's outgoing commits.
    PrDescription,
    /// A short (≤60 chars) imperative title derived from a task's first prompt.
    TaskTitle,
    /// A short shelf title for the working-tree changes (the Shelve dialog's
    /// magic button). Same diff as a commit message, one-line answer.
    ShelfName,
    /// A polished, well-structured rewrite of a user-written task prompt.
    EnhancePrompt,
    /// A handoff document compacted from a task's stored transcript, for
    /// continuing the work in a fresh session. Unlike the other kinds this one
    /// reads the session history rather than the repository.
    Handoff,
}
