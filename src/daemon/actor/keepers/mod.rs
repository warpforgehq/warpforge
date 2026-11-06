//! Keepers (ADR 0030), the actor glue: the per-task mirror of keeper runs and
//! findings, and the one exhaustive match over `KeeperCommand`.

mod mirror;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::keepers::{precision, KeeperState};
use crate::daemon::store::Store;

type Reply<T> = oneshot::Sender<Result<T, String>>;

pub enum KeeperCommand {
    /// A task's switches, runs, findings and per-keeper precision.
    State {
        task_id: String,
        reply: Reply<wire::KeeperTaskState>,
    },
}

/// Authoritative while the daemon runs; the tables are written behind it.
#[derive(Default)]
pub(crate) struct KeepersState {
    by_task: HashMap<String, KeeperState>,
}

/// Read every task's keeper rows once at startup.
/// @param store the daemon's store, when it opened
/// @returns the mirror the actor starts with
pub(crate) fn load_state(store: Option<&Arc<Mutex<Store>>>) -> KeepersState {
    let by_task = match store.map(|s| s.lock()) {
        Some(Ok(store)) => store.load_keeper_state().unwrap_or_else(|error| {
            eprintln!("[daemon] loading keeper state: {error:#}");
            HashMap::new()
        }),
        _ => HashMap::new(),
    };
    KeepersState { by_task }
}

impl Daemon {
    pub(crate) async fn handle_keeper_command(&mut self, cmd: KeeperCommand) {
        match cmd {
            KeeperCommand::State { task_id, reply } => {
                let _ = reply.send(self.keeper_task_state(&task_id));
            }
        }
    }

    fn keeper_task_state(&self, task_id: &str) -> Result<wire::KeeperTaskState, String> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("unknown task {task_id}"))?;
        let state = self.keepers.task(task_id).cloned().unwrap_or_default();
        let project_states = self
            .tasks
            .values()
            .filter(|other| other.project == task.project)
            .filter_map(|other| self.keepers.task(&other.id));
        Ok(wire::KeeperTaskState {
            task_id: task_id.to_string(),
            switches: task.keepers.clone().unwrap_or_default(),
            runs: state.runs,
            findings: state.findings,
            precision: precision(project_states),
        })
    }

    pub(crate) fn keepers_task_deleted(&mut self, task_id: &str) {
        self.keepers.forget_task(task_id);
    }
}
