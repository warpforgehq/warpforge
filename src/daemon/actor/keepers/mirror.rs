use std::collections::HashMap;

use warpforge_protocol as wire;

use super::KeepersState;
use crate::daemon::keepers::KeeperState;
use crate::daemon::runtime::{Persist, Write};
use crate::daemon::store::KeeperWrite;
use crate::daemon::task::Task;

impl KeepersState {
    pub(crate) fn task(&self, task_id: &str) -> Option<&KeeperState> {
        self.by_task.get(task_id)
    }

    /// Mirror first, then the write-behind queue. A run of a task that is no
    /// longer in `tasks` is dropped: its delete is already queued, and a row
    /// landing after it would be an orphan (ADR 0007 invariant 4).
    pub(crate) fn put_run(
        &mut self,
        persist: &Persist,
        tasks: &HashMap<String, Task>,
        run: wire::KeeperRun,
    ) {
        if !tasks.contains_key(&run.task_id) {
            return;
        }
        let state = self.by_task.entry(run.task_id.clone()).or_default();
        state.put_run(run.clone());
        persist.write(Write::Keeper(KeeperWrite::Run(Box::new(run))));
    }

    /// As [`Self::put_run`]; a finding whose run the task does not hold is
    /// dropped.
    pub(crate) fn put_finding(
        &mut self,
        persist: &Persist,
        tasks: &HashMap<String, Task>,
        task_id: &str,
        finding: wire::KeeperFinding,
    ) {
        if !tasks.contains_key(task_id) {
            return;
        }
        let Some(state) = self.by_task.get_mut(task_id) else {
            return;
        };
        if !state.runs.iter().any(|run| run.id == finding.run_id) {
            return;
        }
        state.put_finding(finding.clone());
        persist.write(Write::Keeper(KeeperWrite::Finding(Box::new(finding))));
    }

    /// @returns the keeper's newest run on the task
    pub(crate) fn latest_run(&self, task_id: &str, keeper_id: &str) -> Option<&wire::KeeperRun> {
        self.task(task_id)?
            .runs
            .iter()
            .filter(|run| run.keeper_id == keeper_id)
            .max_by_key(|run| run.run_number)
    }

    pub(crate) fn all_runs(&self) -> impl Iterator<Item = &wire::KeeperRun> {
        self.by_task.values().flat_map(|state| state.runs.iter())
    }

    pub(crate) fn run(&self, task_id: &str, run_id: &str) -> Option<&wire::KeeperRun> {
        self.task(task_id)?.runs.iter().find(|run| run.id == run_id)
    }

    /// @returns the findings of every run of the keeper on the task
    pub(crate) fn keeper_findings(
        &self,
        task_id: &str,
        keeper_id: &str,
    ) -> Vec<&wire::KeeperFinding> {
        let Some(state) = self.task(task_id) else {
            return Vec::new();
        };
        let runs: Vec<&str> = state
            .runs
            .iter()
            .filter(|run| run.keeper_id == keeper_id)
            .map(|run| run.id.as_str())
            .collect();
        state
            .findings
            .iter()
            .filter(|f| runs.contains(&f.run_id.as_str()))
            .collect()
    }

    pub(crate) fn forget_task(&mut self, task_id: &str) {
        self.by_task.remove(task_id);
    }
}
