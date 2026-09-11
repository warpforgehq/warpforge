//! Deterministic workflow pipeline engine: run-state container and pure
//! helpers (stage prompts, verdict/marker parsing, review merging, context
//! formatting).
//!
//! The pipeline shape is fixed: `plan? → implement → review ⇄ fix`. This
//! module has no side effects — the actor glue that spawns stage sessions,
//! reacts to turn ends, and emits events lives in `actor.rs` and calls into
//! these helpers, so everything here is unit-testable in isolation.

use serde::{Deserialize, Serialize};
use warpforge_protocol as wire;

mod format;
mod parse;
mod prompt;
mod run;

#[cfg(test)]
mod tests;

pub use format::{
    clip_summary, display_output, format_diff, format_findings, has_protocol_payload,
    summarize_findings,
};
pub use parse::{merge_reviews, parse_review_verdict, parse_stage_signal};
pub use prompt::{
    build_fix_prompt, build_implement_prompt, build_plan_prompt, build_rereview_prompt,
    build_reviewer_prompt, reask_verdict_prompt, PromptCtx,
};
pub use run::WorkflowRun;

/// Byte budget for the diff embedded into review/fix prompts.
pub const DIFF_CONTEXT_MAX_BYTES: usize = 200 * 1024;
/// Byte budget for the implementer-summary context section (tail wins).
pub const SUMMARY_CONTEXT_MAX_BYTES: usize = 16 * 1024;
/// How many times a reviewer is re-asked for a parseable verdict before the
/// pipeline fails.
pub const MAX_VERDICT_REASKS: u8 = 1;
/// Cap on rounds granted by a single `workflow.decide { extend }`.
pub const MAX_EXTEND_ROUNDS: u32 = 5;

// ─── Stages and state ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageKind {
    Plan,
    Implement,
    Review,
    Fix,
}

impl StageKind {
    pub fn label(self) -> &'static str {
        match self {
            StageKind::Plan => "plan",
            StageKind::Implement => "implement",
            StageKind::Review => "review",
            StageKind::Fix => "fix",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            StageKind::Plan => "Plan",
            StageKind::Implement => "Implement",
            StageKind::Review => "Review",
            StageKind::Fix => "Fix",
        }
    }

    pub fn wire(self) -> wire::WorkflowStage {
        match self {
            StageKind::Plan => wire::WorkflowStage::Plan,
            StageKind::Implement => wire::WorkflowStage::Implement,
            StageKind::Review => wire::WorkflowStage::Review,
            StageKind::Fix => wire::WorkflowStage::Fix,
        }
    }

    pub fn node_kind(self) -> wire::OrchNodeKind {
        match self {
            StageKind::Plan => wire::OrchNodeKind::Plan,
            StageKind::Implement => wire::OrchNodeKind::Implement,
            StageKind::Review => wire::OrchNodeKind::Review,
            StageKind::Fix => wire::OrchNodeKind::Fix,
        }
    }

    /// The stage that follows a successfully completed one. Review is not a
    /// simple successor — it branches on the merged verdict — so it has no
    /// entry here.
    pub fn successor(self) -> Option<StageKind> {
        match self {
            StageKind::Plan => Some(StageKind::Implement),
            StageKind::Implement => Some(StageKind::Review),
            StageKind::Fix => Some(StageKind::Review),
            StageKind::Review => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum RunState {
    /// A stage's child session(s) are running.
    Running {
        stage: StageKind,
    },
    /// A stage asked `need_user_input`; suspended until `workflow.reply`.
    AwaitingReply {
        stage: StageKind,
        child: String,
        question: String,
    },
    /// Review rounds exhausted with open findings; suspended until
    /// `workflow.decide`.
    AwaitingLimitDecision,
    /// Soft-paused at a stage barrier; `next` starts on `workflow.resume`.
    Paused {
        next: StageKind,
    },
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Severity::Critical => "critical",
            Severity::High => "high",
            Severity::Medium => "medium",
            Severity::Low => "low",
        }
    }

    /// Low-severity findings go to the final summary, not to the fixer.
    pub fn goes_to_fix(self) -> bool {
        !matches!(self, Severity::Low)
    }

    /// Map an agent's severity word onto the four levels. Agents use a much
    /// wider vocabulary than the protocol asks for, and the default matters:
    /// an unknown word becomes `Medium`, which forces a repair round, so
    /// opinion-shaped words must land in `Low` rather than fall through.
    fn parse(s: &str) -> Severity {
        match s.trim().to_ascii_lowercase().as_str() {
            "critical" | "blocker" | "blocking" | "severe" | "fatal" => Severity::Critical,
            "high" | "major" | "important" => Severity::High,
            "low" | "minor" | "nit" | "nitpick" | "info" | "informational" | "suggestion"
            | "style" | "cosmetic" | "trivial" | "optional" | "polish" | "note" => Severity::Low,
            _ => Severity::Medium,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub severity: Severity,
    pub file: Option<String>,
    /// Line in the post-change file, when the reviewer pinned one down.
    #[serde(default)]
    pub line: Option<u32>,
    /// A short verbatim excerpt of the offending code. More robust than a line
    /// number — the fixer can search for it after the file has shifted.
    #[serde(default)]
    pub snippet: Option<String>,
    pub description: String,
    /// Reviewer label, e.g. "reviewer 2 (codex)".
    pub reviewer: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Approve,
    RequestChanges,
}

impl Verdict {
    pub fn wire(self) -> wire::WorkflowVerdict {
        match self {
            Verdict::Approve => wire::WorkflowVerdict::Approve,
            Verdict::RequestChanges => wire::WorkflowVerdict::RequestChanges,
        }
    }
}

/// How a pipeline ends.
#[derive(Debug, Clone, PartialEq)]
pub enum WorkflowOutcome {
    /// Reviewers approved, or the user chose to finish with open findings.
    Success { limit_hit: bool },
    /// Stopped by the user (task cancel, or `workflow.decide { stop }`).
    Stopped,
    /// Infrastructure or protocol failure.
    Error(String),
}

/// One spawned stage child, kept for the orchestration graph on the board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageRecord {
    pub kind: StageKind,
    pub task_id: String,
    pub agent: String,
    /// Display label, e.g. "review 1/2 (codex)".
    pub label: String,
    pub status: wire::OrchNodeStatus,
}

/// The machine-readable signal at the end of a plan/implement/fix stage.
#[derive(Debug, Clone, PartialEq)]
pub enum StageSignal {
    /// The stage needs an answer from the user before it can continue.
    Question(String),
    /// Normal completion; the stage's text output is its result.
    Output,
}
