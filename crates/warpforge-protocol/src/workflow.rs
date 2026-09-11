//! Workflow runs and orchestration: run state, stages, verdicts, barriers
//! and the planner/worker/reviewer graph.

use serde::{Deserialize, Serialize};

/// One agent session referenced by an inline workflow timeline event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEventAgent {
    pub task_id: String,
    pub label: String,
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEventKind {
    WorkflowStarted,
    StageStarted,
    AgentOutput,
    ReviewResult,
    Status,
    WorkflowFinished,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEventTone {
    Info,
    Running,
    Success,
    Warning,
    Error,
}

/// Orchestration graph info, embedded in a parent TaskInfo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchGraphInfo {
    pub id: String,
    pub goal: String,
    pub nodes: Vec<OrchNodeInfo>,
}

/// A single node in the orchestration graph.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchNodeInfo {
    pub id: String,
    pub kind: OrchNodeKind,
    pub agent: String,
    pub status: OrchNodeStatus,
    /// Task ID on the board — click to open TaskDetail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    /// Node result text from the agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrchNodeKind {
    Plan,
    Implement,
    Review,
    Merge,
    /// Workflow-pipeline repair stage (fix findings from a review round).
    Fix,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrchNodeStatus {
    Pending,
    Running,
    Complete,
    Failed,
    Skipped,
}

/// One selectable workflow template, as returned by `workflow.list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowMeta {
    pub id: String,
    /// Display name from the YAML; falls back to the id for invalid files.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: WorkflowSource,
    /// False when the file failed to parse or validate — such workflows are
    /// listed (greyed out in the picker, `error` in the tooltip) but cannot
    /// be selected.
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Non-fatal issues (unknown keys, clamped values).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// Stage names for the picker tooltip, e.g. ["plan","implement","review×2","fix"].
    /// Empty for invalid files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stages: Vec<String>,
    /// Review ⇄ fix round limit. 0 for invalid files.
    #[serde(default)]
    pub max_rounds: u32,
}

/// Where a workflow definition comes from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowSource {
    Project,
    Builtin,
}

/// A `workflow.decide` choice after review rounds are exhausted.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowDecision {
    /// Grant extra review ⇄ fix rounds and continue.
    Extend,
    /// Finish as Waiting with the open findings in the summary.
    Finish,
    /// Stop the pipeline (parent becomes Interrupted).
    Stop,
}

/// Live state of a workflow pipeline, carried on the parent task and updated
/// via `task.updated` events.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunInfo {
    pub workflow_id: String,
    pub workflow_name: String,
    pub stage: WorkflowStage,
    /// Current review round, 1-based; 0 until the first review starts.
    pub round: u32,
    /// Effective round limit: the YAML `max_rounds` plus user-granted
    /// extensions.
    pub max_rounds: u32,
    /// Latest merged review verdict.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<WorkflowVerdict>,
    /// Present while the pipeline waits for the user — the parent composer
    /// opens on this, and it drives the attention ("Needs you") rail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waiting: Option<WorkflowWaiting>,
    /// A pause has been requested and takes effect when the running stage
    /// finishes. Lets the UI show progress instead of an idle Pause button.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pause_requested: bool,
}

/// Pipeline position for display.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStage {
    Plan,
    Implement,
    Review,
    Fix,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowVerdict {
    Approve,
    RequestChanges,
}

/// Why a pipeline is suspended and what input unblocks it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowWaiting {
    pub kind: WorkflowWaitKind,
    /// Which stage asked (for `question`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<WorkflowStage>,
    /// The question text (for `question`), or a short findings summary (for
    /// `limit`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowWaitKind {
    /// A stage asked `need_user_input` — answer with `workflow.reply`.
    Question,
    /// Review rounds exhausted with open findings — answer with
    /// `workflow.decide`.
    Limit,
    /// Soft-paused — continue with `workflow.resume`.
    Paused,
}

/// Orchestrator configuration DTO (wire format).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorConfigDto {
    pub planner_agent: String,
    pub worker_pool: Vec<OrchWorkerPoolDto>,
    pub reviewer_pool: Vec<OrchReviewerPoolDto>,
    pub worktrees_enabled: bool,
}

impl Default for OrchestratorConfigDto {
    fn default() -> Self {
        Self {
            planner_agent: "claude".into(),
            worker_pool: vec![
                OrchWorkerPoolDto {
                    agent: "claude".into(),
                },
                OrchWorkerPoolDto {
                    agent: "codex".into(),
                },
            ],
            reviewer_pool: vec![OrchReviewerPoolDto {
                agent: "opencode".into(),
            }],
            worktrees_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchWorkerPoolDto {
    pub agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchReviewerPoolDto {
    pub agent: String,
}
