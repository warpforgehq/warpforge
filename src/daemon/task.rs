use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Mirror of `wire::TaskStatus`; see that enum for why `Waiting` is one state
/// and not the old `Idle` / `NeedsReview` pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskStatus {
    Queued,
    Running,
    /// Turn over; waiting on the human. Whether there is a diff to look at is
    /// `files_changed > 0`, not a separate status.
    Waiting,
    Blocked,
    Interrupted,
    Done,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskStatus::Queued => "queued",
            TaskStatus::Running => "running",
            TaskStatus::Waiting => "waiting",
            TaskStatus::Done => "done",
            TaskStatus::Blocked => "blocked",
            TaskStatus::Interrupted => "interrupted",
        };
        f.write_str(s)
    }
}

/// A unit of work on the board: a prompt handed to an agent within one project.
///
/// `id` (the task) and `session_id` (the ACP agent session) are deliberately
/// **separate** identifiers. Today a task has at most one session, but the
/// roadmap has multiple agents collaborating on a single task — so nothing
/// keys session state off the task id. Keeping them distinct now means that
/// future is additive (N sessions under a task), not a schema migration.
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub session_id: Option<String>,
    pub project: String,
    pub prompt: String,
    pub agent: String,
    pub status: TaskStatus,
    pub tags: Vec<String>,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub files_changed: u32,
    pub blocked_reason: Option<String>,
    /// Why the task is blocked, when the daemon can say something more useful
    /// than the raw message. `None` = no classification; read `blocked_reason`.
    pub blocked_kind: Option<warpforge_protocol::TaskBlockedKind>,
    /// Latest session selectors (model/mode/…) from the ACP session. Persisted
    /// so resumed/interrupted tasks keep the last known controls after restart.
    pub config_options: Vec<warpforge_protocol::ConfigOption>,
    /// Path to the git worktree for this task, if it runs isolated.
    /// `None` = run in the project's main working directory.
    pub worktree: Option<String>,
    /// The branch this task's worktree forked from, recorded at creation so a
    /// merge after a restart targets the real base rather than the root's
    /// current branch (ADR 0015). `None` for a task without a worktree, or one
    /// created before this was persisted.
    pub base_branch: Option<String>,
    /// Orchestration graph for parent orchestrator tasks.
    pub orchestration_graph: Option<warpforge_protocol::OrchGraphInfo>,
    /// Live workflow pipeline state for workflow parent tasks. Derived from
    /// the engine's run (not persisted with the task — the run itself is).
    pub workflow_run: Option<warpforge_protocol::WorkflowRunInfo>,
    /// When this task was spawned by an orchestrator agent as a sub-agent, the
    /// id of that orchestrator task. Its result is delivered back into the
    /// parent's inbox on completion.
    pub parent_task_id: Option<String>,
    /// Explicit settle override (true = settled, false = not settled).
    /// `None` = derive from execution status only.
    pub settled_override: Option<bool>,
    /// Unix seconds when the task was last settled.
    pub settled_at: Option<u64>,
    /// Unix seconds until which the task is snoozed.
    pub snoozed_until: Option<u64>,
    /// Unix seconds when the current snooze was set.
    pub snoozed_at: Option<u64>,
    /// Agent account this task's session was started with. Recorded so resume
    /// and restart reuse the same account even after the active one changed.
    /// `None` = whatever account is active at spawn time.
    pub account_id: Option<String>,
    /// Id of the backlog item this task was started from, if any.
    pub backlog_item_id: Option<String>,
    /// What created this task, when it is not the board. `pr-review` marks the
    /// shadow task behind a pull request's Assistant tab — the surface owns
    /// it, so clients keep it out of their board lists and the daemon sweeps
    /// it on its own schedule (see `origin_sweep`).
    pub origin: Option<String>,
    /// Last explicit model intent the user expressed for this task.
    pub model: Option<String>,
    /// Messages submitted while the agent was mid-turn, waiting to be sent as
    /// their own turns. Live session state, so it is never persisted.
    pub queued_prompts: Vec<warpforge_protocol::QueuedPrompt>,
    /// The agent this task consults through `ask_advisor`, and the hidden
    /// task its advice runs in once started (ADR 0022).
    pub advisor: Option<warpforge_protocol::TaskAdvisor>,
    /// What the session says it is doing, for its peers (ADR 0026). Live
    /// state, like `queued_prompts`, so it is never persisted.
    pub status_note: Option<String>,
    /// Set when the task runs as a Smith: its thread, or a work session.
    pub smith: Option<TaskSmith>,
    /// The write paths of the Smith session it was spawned under, copied at
    /// creation (ADR 0027 invariant 16): no persona, only the limit.
    pub write_limit: Option<TaskWriteLimit>,
}

/// A Smith's write paths carried by a task that does not run as the Smith.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TaskWriteLimit {
    /// The Smith whose limit it is.
    pub smith_id: String,
    /// Path prefixes it may write, relative to its worktree; never empty.
    pub paths: Vec<String>,
}

/// What a Smith task's sessions were given (ADR 0027), so a resume sends the
/// same system prompt and later prompts send only what changed.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct TaskSmith {
    pub smith_id: String,
    /// Constitution and soul, fixed at the first session start; `_meta` and
    /// resumes reuse it byte for byte (invariant 4).
    #[serde(default)]
    pub prompt: Option<String>,
    /// The prompt goes as `_meta.systemPrompt` rather than an opening prefix.
    #[serde(default)]
    pub via_meta: bool,
    /// The soul commit the session has heard last.
    #[serde(default)]
    pub soul_rev: Option<String>,
    /// Row id of the newest journal entry the session has been given.
    #[serde(default)]
    pub journal_seen: u64,
    /// The daemon's settle entry was written to the journal.
    #[serde(default)]
    pub journaled: bool,
    /// How many `start_work` hops led here: 0 for the thread or a session
    /// the user started.
    #[serde(default)]
    pub depth: u8,
    /// The task whose `start_work` asked for this one; it gets the report.
    #[serde(default)]
    pub report_to: Option<String>,
    /// The settle report was sent to `report_to`.
    #[serde(default)]
    pub reported: bool,
}

impl TaskSmith {
    /// @param smith_id the Smith the task runs as
    /// @returns a record with nothing given yet
    pub fn new(smith_id: &str) -> Self {
        Self {
            smith_id: smith_id.to_string(),
            ..Default::default()
        }
    }
}

/// A fresh task id, for a caller that has to name the task before it exists.
/// @returns an id in the form every task has
pub fn new_task_id() -> String {
    format!("t_{}", &Uuid::new_v4().to_string()[..8])
}

impl Task {
    pub fn new(project: &str, prompt: &str, agent: &str, tags: Vec<String>) -> Self {
        let ts = now_secs();
        let title = derive_title(prompt);
        Self {
            id: new_task_id(),
            session_id: None,
            project: project.to_string(),
            prompt: prompt.to_string(),
            agent: agent.to_string(),
            status: TaskStatus::Queued,
            tags,
            title,
            created_at: ts,
            updated_at: ts,
            files_changed: 0,
            blocked_reason: None,
            blocked_kind: None,
            config_options: Vec::new(),
            worktree: None,
            base_branch: None,
            orchestration_graph: None,
            workflow_run: None,
            parent_task_id: None,
            settled_override: None,
            settled_at: None,
            snoozed_until: None,
            snoozed_at: None,
            account_id: None,
            backlog_item_id: None,
            origin: None,
            model: None,
            queued_prompts: Vec::new(),
            advisor: None,
            status_note: None,
            write_limit: None,
            smith: None,
        }
    }

    /// Attach an agent session to this task. The session id is generated by
    /// (or negotiated with) the ACP layer; it is never derived from `id`.
    pub fn attach_session(&mut self, session_id: String) {
        self.session_id = Some(session_id);
        self.status = TaskStatus::Running;
        self.updated_at = now_secs();
    }

    pub fn set_status(&mut self, status: TaskStatus) {
        self.status = status;
        self.updated_at = now_secs();
    }
}

/// Derive a display title from a prompt: first line, stripped of leading
/// whitespace and markdown fences, truncated to 80 characters. Returns empty
/// string for empty prompts.
pub(crate) fn derive_title(prompt: &str) -> String {
    let line = prompt
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches("# ")
        .trim_start_matches('*')
        .trim_start_matches('-')
        .trim();
    let max = 80;
    if line.len() <= max {
        line.to_string()
    } else {
        let end = line
            .char_indices()
            .take(max)
            .last()
            .map(|(i, _)| i)
            .unwrap_or(max);
        line[..end].to_string()
    }
}
