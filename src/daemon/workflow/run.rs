use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use warpforge_protocol as wire;

use crate::workflow_config::WorkflowSpec;

use super::{format, Finding, RunState, StageKind, StageRecord, Verdict};

// ─── The run ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub parent_id: String,
    pub project: String,
    pub spec: WorkflowSpec,
    /// Lead agent / model picked in the New Task dialog — the fallback for
    /// every stage that doesn't override them.
    pub lead_agent: String,
    pub lead_model: Option<String>,
    pub state: RunState,
    /// 1-based review round; 0 until the first review starts.
    pub round: u32,
    /// Extra rounds granted by `workflow.decide { extend }`.
    pub extra_rounds: u32,
    /// Set by `workflow.pause` while a stage is running; takes effect at the
    /// next stage barrier.
    pub pause_requested: bool,
    /// Free-text from resume/decide, delivered to the next spawned stage as a
    /// "User guidance" block and then cleared.
    pub pending_guidance: Option<String>,
    pub plan_output: Option<String>,
    /// Final text of the last implement/fix session.
    pub last_summary: Option<String>,
    pub last_verdict: Option<Verdict>,
    /// Findings of the latest review round that still need fixing.
    #[serde(default)]
    pub open_findings: Vec<Finding>,
    /// Low-severity findings accumulated for the final summary only.
    #[serde(default)]
    pub deferred_findings: Vec<Finding>,
    /// child task id → reviewer index, while a review stage is in flight.
    #[serde(default)]
    pub review_pending: HashMap<String, usize>,
    /// (reviewer index, verdict, findings) collected this round.
    #[serde(default)]
    pub review_collected: Vec<(usize, Verdict, Vec<Finding>)>,
    /// child task id → verdict re-ask count.
    #[serde(default)]
    pub reasked: HashMap<String, u8>,
    /// child task id → stage kind, for routing TurnEnded (single-child stages).
    #[serde(default)]
    pub active_children: HashMap<String, StageKind>,
    /// reviewer index → child task id of the previous review round. With
    /// `review.reask: same_session` the next round follows up in these
    /// sessions instead of spawning fresh ones.
    #[serde(default)]
    pub prior_review_children: HashMap<usize, String>,
    #[serde(default)]
    pub history: Vec<StageRecord>,
    /// Attachments from the New Task dialog, delivered to the first stage.
    #[serde(default)]
    pub attachments: Vec<wire::PromptAttachment>,
    /// Whether stage sessions get the project's runtime-context preamble, as
    /// picked in the New Task dialog.
    #[serde(default)]
    pub include_runtime_context: bool,
    /// Non-model session config picks from the dialog (reasoning effort, mode),
    /// applied to every stage session.
    #[serde(default)]
    pub config_overrides: HashMap<String, String>,
}

impl WorkflowRun {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        parent_id: String,
        project: String,
        spec: WorkflowSpec,
        lead_agent: String,
        lead_model: Option<String>,
        attachments: Vec<wire::PromptAttachment>,
        include_runtime_context: bool,
        config_overrides: HashMap<String, String>,
    ) -> Self {
        Self {
            parent_id,
            project,
            spec,
            lead_agent,
            lead_model,
            state: RunState::Running {
                stage: StageKind::Implement, // set properly by the first spawn
            },
            round: 0,
            extra_rounds: 0,
            pause_requested: false,
            pending_guidance: None,
            plan_output: None,
            last_summary: None,
            last_verdict: None,
            open_findings: Vec::new(),
            deferred_findings: Vec::new(),
            review_pending: HashMap::new(),
            review_collected: Vec::new(),
            prior_review_children: HashMap::new(),
            reasked: HashMap::new(),
            active_children: HashMap::new(),
            history: Vec::new(),
            attachments: Vec::new(),
            include_runtime_context,
            config_overrides,
        }
        .with_attachments(attachments)
    }

    fn with_attachments(mut self, attachments: Vec<wire::PromptAttachment>) -> Self {
        self.attachments = attachments;
        self
    }

    pub fn first_stage(&self) -> StageKind {
        if self.spec.plan.is_some() {
            StageKind::Plan
        } else {
            StageKind::Implement
        }
    }

    pub fn effective_max_rounds(&self) -> u32 {
        self.spec.review.max_rounds + self.extra_rounds
    }

    pub fn is_active(&self) -> bool {
        !matches!(self.state, RunState::Done | RunState::Failed)
    }

    /// Agent + model for a stage, applying the fallback chain:
    /// stage override → (fix falls back to implement) → lead agent/model.
    pub fn stage_agent(
        &self,
        kind: StageKind,
        reviewer: Option<usize>,
    ) -> (String, Option<String>) {
        let (agent, model) = match kind {
            StageKind::Plan => {
                let s = self.spec.plan.as_ref();
                (
                    s.and_then(|s| s.agent.clone()),
                    s.and_then(|s| s.model.clone()),
                )
            }
            StageKind::Implement => (
                self.spec.implement.agent.clone(),
                self.spec.implement.model.clone(),
            ),
            StageKind::Fix => (
                self.spec
                    .fix
                    .agent
                    .clone()
                    .or_else(|| self.spec.implement.agent.clone()),
                self.spec
                    .fix
                    .model
                    .clone()
                    .or_else(|| self.spec.implement.model.clone()),
            ),
            StageKind::Review => {
                let r = reviewer.and_then(|i| self.spec.review.reviewers.get(i));
                (
                    r.and_then(|r| r.agent.clone()),
                    r.and_then(|r| r.model.clone()),
                )
            }
        };
        (
            agent.unwrap_or_else(|| self.lead_agent.clone()),
            model.or_else(|| self.lead_model.clone()),
        )
    }

    pub fn reviewer_label(&self, index: usize) -> String {
        let total = self.spec.review.reviewers.len();
        let (agent, _) = self.stage_agent(StageKind::Review, Some(index));
        if total == 1 {
            format!("reviewer ({agent})")
        } else {
            format!("reviewer {}/{total} ({agent})", index + 1)
        }
    }

    pub fn record_stage(&mut self, kind: StageKind, task_id: &str, agent: &str, label: String) {
        self.history.push(StageRecord {
            kind,
            task_id: task_id.to_string(),
            agent: agent.to_string(),
            label,
            status: wire::OrchNodeStatus::Running,
        });
    }

    pub fn set_record_status(&mut self, task_id: &str, status: wire::OrchNodeStatus) {
        if let Some(rec) = self.history.iter_mut().rev().find(|r| r.task_id == task_id) {
            rec.status = status;
        }
    }

    /// Take the pending guidance (it is delivered to exactly one stage).
    pub fn take_guidance(&mut self) -> Option<String> {
        self.pending_guidance.take()
    }

    /// Every stage child this run ever spawned. Completed stages keep their
    /// sessions alive during the run (same-session re-review needs them), so
    /// final cleanup must sweep this full set, not just `active_children`.
    pub fn all_children(&self) -> std::collections::HashSet<String> {
        self.history
            .iter()
            .map(|record| record.task_id.clone())
            .chain(self.active_children.keys().cloned())
            .collect()
    }

    // ── Wire projections ──

    pub fn wire_info(&self) -> wire::WorkflowRunInfo {
        let (stage, waiting) = match &self.state {
            RunState::Running { stage } => (stage.wire(), None),
            RunState::AwaitingReply {
                stage, question, ..
            } => (
                stage.wire(),
                Some(wire::WorkflowWaiting {
                    kind: wire::WorkflowWaitKind::Question,
                    stage: Some(stage.wire()),
                    question: Some(question.clone()),
                }),
            ),
            RunState::AwaitingLimitDecision => (
                wire::WorkflowStage::Review,
                Some(wire::WorkflowWaiting {
                    kind: wire::WorkflowWaitKind::Limit,
                    stage: Some(wire::WorkflowStage::Review),
                    question: Some(format::summarize_findings(&self.open_findings)),
                }),
            ),
            RunState::Paused { next } => (
                next.wire(),
                Some(wire::WorkflowWaiting {
                    kind: wire::WorkflowWaitKind::Paused,
                    stage: Some(next.wire()),
                    question: None,
                }),
            ),
            RunState::Done => (wire::WorkflowStage::Done, None),
            RunState::Failed => (wire::WorkflowStage::Failed, None),
        };
        wire::WorkflowRunInfo {
            workflow_id: self.spec.id.clone(),
            workflow_name: self.spec.name.clone(),
            stage,
            round: self.round,
            max_rounds: self.effective_max_rounds(),
            verdict: self.last_verdict.map(Verdict::wire),
            waiting,
            pause_requested: self.pause_requested,
        }
    }

    pub fn graph_info(&self) -> wire::OrchGraphInfo {
        wire::OrchGraphInfo {
            id: self.parent_id.clone(),
            goal: self.spec.name.clone(),
            nodes: self
                .history
                .iter()
                .map(|rec| wire::OrchNodeInfo {
                    id: rec.label.clone(),
                    kind: rec.kind.node_kind(),
                    agent: rec.agent.clone(),
                    status: rec.status,
                    task_id: Some(rec.task_id.clone()),
                    result: None,
                })
                .collect(),
        }
    }
}
