//! Workflow templates: `.warpforge/workflows/*.yaml` parsing and validation,
//! `{{placeholder}}` prompt-template rendering, and the built-in templates
//! shipped with the binary.
//!
//! The pipeline shape is fixed (`plan? → implement → review ⇄ fix`), so a
//! workflow file configures the fixed stages rather than declaring arbitrary
//! ones.
//!
//! This module is deliberately independent of daemon internals: the daemon's
//! workflow engine consumes [`WorkflowSpec`], and everything here is plain
//! sync code unit-testable in isolation.

mod parse;
mod registry;
mod template;
#[cfg(test)]
mod tests;

pub use parse::parse_workflow;
pub use registry::{eject_builtin, list_workflows, load_workflow};
pub use template::{
    extract_placeholders, render_template, VARS_FIX, VARS_IMPLEMENT, VARS_PLAN, VARS_REVIEW,
};

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub fn workflows_dir(project_path: &Path) -> PathBuf {
    project_path.join(".warpforge").join("workflows")
}

/// The only workflow file format version this build understands.
pub const SUPPORTED_VERSION: u64 = 1;
/// Hard cap on review ⇄ fix rounds a YAML may request (a human can still
/// extend a running pipeline past this — that is an explicit decision).
pub const MAX_ROUNDS_CAP: u32 = 5;
/// Default review rounds. A fix runs *between* rounds, so N rounds buy N-1
/// repair attempts: 3 keeps a second attempt available when the first fix
/// misses, which is the common case.
pub const DEFAULT_MAX_ROUNDS: u32 = 3;
pub const MAX_REVIEWERS: usize = 4;

/// Built-in templates, selectable everywhere and ejectable into a project.
/// A project file with the same id overrides (hides) the built-in.
pub const BUILTIN_WORKFLOWS: &[(&str, &str)] = &[
    ("review-loop", include_str!("../workflows/review-loop.yaml")),
    (
        "plan-review-loop",
        include_str!("../workflows/plan-review-loop.yaml"),
    ),
];

// ─── Validated model ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkflowSpec {
    /// File stem for project workflows, registry key for built-ins.
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// `Some` when the optional planning stage is enabled.
    pub plan: Option<StageConfig>,
    pub implement: StageConfig,
    pub review: ReviewConfig,
    pub fix: StageConfig,
}

/// Per-stage overrides. `None` falls back to the lead agent / model picked in
/// the New Task dialog (for `fix`: to the `implement` stage's values) and to
/// the built-in stage prompt.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StageConfig {
    pub agent: Option<String>,
    pub model: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewConfig {
    pub max_rounds: u32,
    pub on_limit: OnLimit,
    /// How repeat review rounds are staffed after a fix.
    #[serde(default)]
    pub reask: ReaskMode,
    // These collections carry `serde(default)` because a `WorkflowSpec` is
    // persisted inside a running pipeline's snapshot: a field that is required
    // on load turns every in-flight run unreadable after an upgrade.
    #[serde(default)]
    pub context: Vec<ReviewContextItem>,
    /// Always 1..=MAX_REVIEWERS entries; defaults to one all-`None` reviewer.
    #[serde(default)]
    pub reviewers: Vec<ReviewerConfig>,
    /// True when the YAML set `context` explicitly. Only drives the warning
    /// that the key is inert alongside custom reviewer prompts.
    #[serde(default, skip_serializing)]
    pub context_was_set: bool,
}

/// Who reviews repeat rounds after a fix.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReaskMode {
    /// Follow up in the same reviewer session: it remembers its own findings
    /// and verifies each one is actually resolved, at the cost of some
    /// anchoring bias. Falls back to a fresh session when the old one is gone
    /// (daemon restart, agent death).
    #[default]
    SameSession,
    /// Spawn fresh reviewer sessions every round. The previous round's
    /// findings are still included in the prompt for verification.
    Fresh,
}

/// What the pipeline does when `max_rounds` is exhausted with open findings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnLimit {
    /// Suspend and ask the user (extend / finish / stop).
    Ask,
    /// Finish as Waiting with the open findings in the summary.
    Finish,
}

/// One piece of context assembled into a reviewer's prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewContextItem {
    /// The task prompt the user typed.
    Prompt,
    /// The plan stage output, when that stage ran.
    Plan,
    /// The final text of the last implement/fix session.
    ImplementerSummary,
    /// The working-copy diff.
    Diff,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReviewerConfig {
    pub agent: Option<String>,
    pub model: Option<String>,
    /// Appended to the default reviewer prompt (available as `{{focus}}`).
    pub focus: Option<String>,
    /// Full prompt override for this reviewer.
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowSource {
    Project,
    Builtin,
}

/// A workflow as found on disk (or built in): invalid files are carried as
/// `Err` so pickers can list them greyed-out with the reason.
#[derive(Debug)]
pub struct LoadedWorkflow {
    pub id: String,
    pub source: WorkflowSource,
    pub spec: Result<WorkflowSpec, String>,
    pub warnings: Vec<String>,
}

impl WorkflowSpec {
    /// Stage names for picker tooltips, e.g. `["plan", "implement", "review×2", "fix"]`.
    pub fn stage_summary(&self) -> Vec<String> {
        let mut stages = Vec::new();
        if self.plan.is_some() {
            stages.push("plan".to_string());
        }
        stages.push("implement".to_string());
        stages.push(match self.review.reviewers.len() {
            1 => "review".to_string(),
            n => format!("review×{n}"),
        });
        stages.push("fix".to_string());
        stages
    }
}
