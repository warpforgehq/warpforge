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
    #[cfg_attr(not(test), allow(dead_code))]
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
    #[cfg_attr(not(test), allow(dead_code))]
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

    pub(crate) fn forget_task(&mut self, task_id: &str) {
        self.by_task.remove(task_id);
    }
}
