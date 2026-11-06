//! Keepers (ADR 0030): agents attached to a task that check its committed
//! change. Definitions come from `.warpforge/keepers/<id>.yaml`; runs and
//! findings are daemon state.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::SessionUsageCost;

/// What starts a keeper's run.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperWhen {
    #[default]
    Commit,
    Ready,
    Ci,
    Comments,
}

/// Which protocol a checker answers in, and how it maps onto an outcome.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperResultKind {
    #[default]
    Findings,
    PassFail,
    Verdict,
    Draft,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperSeverity {
    Critical,
    High,
    #[default]
    Medium,
    Low,
}

/// How a finished run ended. A run still in flight has none.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperOutcome {
    Green,
    Findings,
    Inconclusive,
    Error,
    Skipped,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperFindingStatus {
    #[default]
    Open,
    Sent,
    Fixed,
    Dismissed,
    Superseded,
}

/// A keeper file after its preset is applied and its values are validated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeeperDefinition {
    /// The file stem.
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    pub when: KeeperWhen,
    pub result: KeeperResultKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    pub time_limit_secs: u64,
    pub max_rounds: u32,
    pub min_severity: KeeperSeverity,
    /// Whether a new task in the project starts with this keeper on.
    pub default_on: bool,
    /// Globs; a leading `!` excludes. Empty means every path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// The full prompt template, preamble included, before rendering.
    pub prompt: String,
}

/// One keeper file as listed for a project; an invalid file carries `error`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeeperEntry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<KeeperDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// A task's per-keeper switches over each file's `default`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct TaskKeepers {
    /// Keeper id → on.
    pub overrides: BTreeMap<String, bool>,
    /// Keeper id → its fix loop on this task.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub loops: BTreeMap<String, KeeperLoop>,
}

/// Why a keeper's fix loop stopped and waits for the owner.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperStop {
    MaxRounds,
    NoProgress,
}

/// One keeper's fix loop on a task, persisted with the task's switches.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct KeeperLoop {
    /// Fix rounds handed to the task's session since the keeper's last green.
    pub rounds: u32,
    /// Rounds the owner added with Extend.
    pub extra_rounds: u32,
    /// The HEAD the latest round was handed over for; a round counts once.
    pub round_head: Option<String>,
    /// The HEAD of a round handed over whose turn has not ended yet.
    pub pending_head: Option<String>,
    pub stop: Option<KeeperStop>,
    /// The run the owner extended past; the no-progress rule skips it.
    pub extended_run: Option<String>,
    /// The HEAD the owner accepted as it is; nothing is sent until HEAD moves.
    pub accepted_head: Option<String>,
    /// The owner's guidance for the next fix prompt, from Extend.
    pub guidance: Option<String>,
}

/// What a keeper's fix loop is doing, as clients show it.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperLoopStatus {
    #[default]
    Idle,
    /// Findings are ready but the task is busy, dirty or out of quota.
    Waiting,
    /// The fix prompt is with the task's session.
    Fixing,
    /// Stopped; Extend, Accept or Off decides.
    NeedsYou,
    Accepted,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct KeeperLoopState {
    pub status: KeeperLoopStatus,
    /// Why it waits, for `waiting`.
    pub reason: Option<String>,
    pub stop: Option<KeeperStop>,
    pub rounds: u32,
    /// `max_rounds` plus the rounds the owner added.
    pub max_rounds: u32,
}

/// The owner's answer to a stopped loop.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeeperDecision {
    /// More rounds, with optional guidance.
    Extend,
    /// Record as it is; quiet until the next commit.
    Accept,
    /// Off for this task.
    Off,
}

/// One check of one keeper on one HEAD.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct KeeperRun {
    pub id: String,
    pub task_id: String,
    pub keeper_id: String,
    /// Counts from 1 per (task, keeper).
    pub run_number: u64,
    pub trigger: KeeperWhen,
    pub head_sha: String,
    pub base_sha: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub outcome: Option<KeeperOutcome>,
    /// Findings at or above the keeper's `min_severity`.
    pub count: u32,
    pub checker_task_id: Option<String>,
    /// The fix round the run checked.
    pub round: u32,
    pub cost: Option<SessionUsageCost>,
    /// Why a run was inconclusive, failed or skipped.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct KeeperFinding {
    pub id: String,
    pub run_id: String,
    /// Stable across runs of one keeper, so a later run can resolve it.
    pub key: String,
    pub severity: KeeperSeverity,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub description: String,
    pub status: KeeperFindingStatus,
    pub dismiss_reason: Option<String>,
    /// When it became `fixed` or `dismissed`; orders the precision window.
    pub resolved_at: Option<u64>,
}

/// Resolved findings of one keeper across a project's tasks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeeperPrecision {
    pub keeper_id: String,
    pub fixed: u32,
    pub dismissed: u32,
}

impl KeeperPrecision {
    /// @returns `fixed / (fixed + dismissed)`, or `None` before any resolution
    pub fn value(&self) -> Option<f64> {
        let sample = self.fixed + self.dismissed;
        (sample > 0).then(|| f64::from(self.fixed) / f64::from(sample))
    }
}

/// The reply to `keepers.state`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeeperTaskState {
    pub task_id: String,
    pub switches: TaskKeepers,
    pub runs: Vec<KeeperRun>,
    pub findings: Vec<KeeperFinding>,
    pub precision: Vec<KeeperPrecision>,
    /// Keeper id → its fix loop, for every keeper with a run on the task.
    #[serde(default)]
    pub loops: BTreeMap<String, KeeperLoopState>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_keeper_records_read_back_from_an_empty_object() {
        let run: KeeperRun = serde_json::from_str("{}").unwrap();
        assert_eq!(run, KeeperRun::default());
        let finding: KeeperFinding = serde_json::from_str("{}").unwrap();
        assert_eq!(finding.status, KeeperFindingStatus::Open);
        let switches: TaskKeepers = serde_json::from_str("{}").unwrap();
        assert!(switches.overrides.is_empty());
        assert!(switches.loops.is_empty());
        let fix: KeeperLoop = serde_json::from_str("{}").unwrap();
        assert_eq!(fix, KeeperLoop::default());
    }
}
