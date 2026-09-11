//! The `Event` enum (daemon → client broadcasts) and the `Snapshot` a client
//! receives when it subscribes.
//!
//! This enum must stay exhaustive in one file; the payload types its variants
//! carry live in the topic modules beside this one.

use crate::{
    AccountInfo, AgentAccountLimits, AgentConfig, Automation, AutomationRun, DetectedAgent,
    PortForwardInfo, PortForwardStatus, PortRangeSource, ProjectConfigState, ServiceInfo,
    ServiceStatus, SessionUpdate, TaskInfo, TerminalInfo, TerminalScreen,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum Event {
    /// Full state snapshot, sent as the reply-adjacent first event after
    /// `state.subscribe` and again after daemon-side recovery.
    #[serde(rename = "state.snapshot")]
    Snapshot(Snapshot),

    #[serde(rename = "project.added")]
    ProjectAdded(ProjectInfo),
    #[serde(rename = "project.removed")]
    ProjectRemoved { name: String },
    /// A registered project's .warpforge.yaml changed. Replaces only the
    /// config-derived slice of client state; task/session history is untouched.
    #[serde(rename = "project.configChanged")]
    ProjectConfigChanged(ProjectConfigState),

    #[serde(rename = "agentLimits.updated")]
    AgentLimitsUpdated { accounts: Vec<AgentAccountLimits> },

    #[serde(rename = "service.status")]
    ServiceStatus {
        project: String,
        service: String,
        status: ServiceStatus,
        allocated_port: u16,
    },
    #[serde(rename = "service.log")]
    ServiceLog {
        project: String,
        service: String,
        /// Monotonic per-service sequence number so clients can detect gaps
        /// and backfill via `service.logs`.
        seq: u64,
        line: String,
    },

    #[serde(rename = "portforward.status")]
    PortForwardStatus {
        project: String,
        name: String,
        status: PortForwardStatus,
    },
    #[serde(rename = "portforward.log")]
    PortForwardLog {
        project: String,
        name: String,
        seq: u64,
        line: String,
    },

    #[serde(rename = "task.created")]
    TaskCreated(TaskInfo),
    #[serde(rename = "task.updated")]
    TaskUpdated(TaskInfo),
    /// A task was deleted; clients should drop it from all views.
    #[serde(rename = "task.removed")]
    TaskRemoved { id: String },

    /// An automation was created or changed — including the scheduler moving
    /// `nextRunAt`, which is what keeps the "Next run" column live.
    #[serde(rename = "automation.updated")]
    AutomationUpdated(Automation),
    #[serde(rename = "automation.removed")]
    AutomationRemoved { id: String },
    /// A run row was written or its status changed.
    #[serde(rename = "automation.runUpdated")]
    AutomationRunUpdated(AutomationRun),

    /// Structured ACP session update for a task: tool calls, agent text,
    /// file edits, permission requests. Mirrors ACP `session/update`.
    #[serde(rename = "session.update")]
    SessionUpdate {
        task_id: String,
        update: SessionUpdate,
    },

    /// Session transcripts of finished tasks older than the retention window
    /// were removed. `updates` counts the deleted rows; emitted only when
    /// something was actually deleted.
    #[serde(rename = "history.pruned")]
    HistoryPruned { updates: u64 },

    /// The retention sweep settled and/or deleted tasks. `settled` counts
    /// ignored diff-less waiting tasks moved to closed (reversible),
    /// `expired` counts untouched closed tasks deleted outright, `kept`
    /// counts closed tasks that still hold unmerged changes and were kept.
    #[serde(rename = "history.swept")]
    HistorySwept {
        settled: u64,
        expired: u64,
        kept: u64,
    },

    /// Daemon detected installed agents on first start; no agents configured
    /// yet. Frontend should show the setup wizard.
    #[serde(rename = "agents.setup_needed")]
    AgentsSetupNeeded { detected: Vec<DetectedAgent> },

    /// Agent registry updated (after setup wizard or settings change).
    #[serde(rename = "agents.updated")]
    AgentsUpdated { agents: Vec<AgentConfig> },

    /// Account list or active selection changed.
    #[serde(rename = "accounts.updated")]
    AccountsUpdated { accounts: Vec<AccountInfo> },

    /// Terminal (PTY) screen changed. Carries the rendered screen contents,
    /// not raw bytes — every client sees the same vt100 state.
    #[serde(rename = "terminal.screen")]
    TerminalScreen {
        terminal_id: String,
        screen: TerminalScreen,
    },
    /// A new terminal was spawned. Additive: clients add this TerminalInfo to
    /// their snapshot.terminals projection. The terminal stays in the snapshot
    /// until a `terminal.exited` event removes it.
    #[serde(rename = "terminal.spawned")]
    TerminalSpawned(TerminalInfo),
    /// Raw PTY output bytes (base64). Additive with terminal.screen — clients
    /// that render via a terminal emulator (xterm.js) use this instead of the
    /// rendered screen spans. Bounded to the <=4096-byte read chunk.
    #[serde(rename = "terminal.data")]
    TerminalData {
        terminal_id: String,
        data_b64: String,
    },
    #[serde(rename = "terminal.exited")]
    TerminalExited { terminal_id: String, code: i32 },

    // ── Orchestration ──
    /// A worker/reviewer node was dispatched.
    #[serde(rename = "orchestration.nodeDispatched")]
    OrchestrationNodeDispatched {
        graph_id: String,
        node_id: String,
        task_id: String,
        agent: String,
        kind: String,
    },
    /// A node completed successfully.
    #[serde(rename = "orchestration.nodeCompleted")]
    OrchestrationNodeCompleted {
        graph_id: String,
        node_id: String,
        task_id: String,
    },
    /// A node failed.
    #[serde(rename = "orchestration.nodeFailed")]
    OrchestrationNodeFailed {
        graph_id: String,
        node_id: String,
        task_id: String,
        reason: String,
    },
    /// All nodes in the orchestration are done.
    #[serde(rename = "orchestration.allComplete")]
    OrchestrationAllComplete { graph_id: String, project: String },

    // ── LSP ──
    /// An opaque LSP JSON-RPC message from a server's stdout.
    #[serde(rename = "lsp.message")]
    LspMessage {
        server_id: String,
        payload: serde_json::Value,
    },
    /// A language server exited (crashed or was stopped).
    #[serde(rename = "lsp.exit")]
    LspExit {
        server_id: String,
        code: Option<i32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<ProjectInfo>,
    pub services: Vec<ServiceInfo>,
    pub portforwards: Vec<PortForwardInfo>,
    pub tasks: Vec<TaskInfo>,
    pub terminals: Vec<TerminalInfo>,
    /// Always empty: the snapshot deliberately carries no transcripts. A
    /// client that opens a chat fetches that task's whole conversation with
    /// `session.history`, so a transcript still arrives in one piece (see
    /// `docs/adr/0005`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub session_history: HashMap<String, Vec<SessionUpdate>>,
    /// All configured agents (enabled or not). Empty until the user completes
    /// the setup wizard.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agents: Vec<AgentConfig>,
    /// Registered agent accounts. Empty until the user adds one; a single
    /// account is still listed so the switcher can show which one is live.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accounts: Vec<AccountInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    /// Inclusive port range assigned to this project.
    pub port_range: (u16, u16),
    /// Where the range came from: an auto scan, a sticky assignment, the
    /// project's declared config range, or a local registry override.
    #[serde(default)]
    pub port_range_source: PortRangeSource,
    /// Name of the project whose declared range this one collides with.
    #[serde(default)]
    pub port_range_conflict: Option<String>,
    /// Services declared in .warpforge.yaml (may not be running).
    pub declared_services: Vec<String>,
    pub agent_templates: HashMap<String, String>,
}
