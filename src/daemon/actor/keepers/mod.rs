//! Keepers (ADR 0030), the actor glue: the per-task mirror of keeper runs and
//! findings, the HEAD poll, the read-only checker sessions, and the one
//! exhaustive match over `KeeperCommand`.

mod checker;
mod finish;
mod mirror;
#[cfg(test)]
mod tests;
mod trigger;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::keepers::{precision, Change, GitSource, HeadWatch, KeeperState};
use crate::daemon::store::Store;

pub(crate) use trigger::spawn_poll;

/// `Task::origin` of a keeper's checker task.
pub(crate) const KEEPER_ORIGIN: &str = "keeper";

type Reply<T> = oneshot::Sender<Result<T, String>>;

pub enum KeeperCommand {
    /// A task's switches, runs, findings and per-keeper precision.
    State {
        task_id: String,
        reply: Reply<wire::KeeperTaskState>,
    },
    /// Read eligible tasks' HEADs now.
    Poll,
    /// `git.commit` succeeded in the task: check it without waiting to settle.
    Committed { task_id: String },
    /// What a poll read, one entry per eligible task.
    Polled { results: Vec<Polled> },
    /// A task's change was read for the keepers due on `head`.
    Gathered {
        task_id: String,
        head: String,
        keepers: Vec<wire::KeeperDefinition>,
        change: Result<Change, String>,
    },
    /// A later run's prompt did not reach the checker's session.
    Undelivered { run_id: String, error: String },
    /// A run's `time_limit` elapsed.
    Deadline { run_id: String },
    #[cfg(test)]
    Script(GitSource),
}

/// One eligible task as a poll saw it.
#[derive(Debug, Clone)]
pub struct Polled {
    pub task_id: String,
    pub head: Option<String>,
    /// The task's `when: commit` keepers that are on.
    pub keepers: Vec<wire::KeeperDefinition>,
}

/// A run handed to a checker and not finished yet.
struct InFlight {
    task_id: String,
    checker_task_id: String,
    definition: wire::KeeperDefinition,
    /// The prompt reached the checker's session.
    dispatched: bool,
    /// The checker's turn for it began; only its end is the result.
    started: bool,
    reasked: bool,
    superseded: bool,
    baseline_cost: Option<f64>,
}

/// Authoritative while the daemon runs; the tables are written behind it.
#[derive(Default)]
pub(crate) struct KeepersState {
    by_task: HashMap<String, KeeperState>,
    watches: HashMap<String, HeadWatch>,
    /// (task, keeper) whose change is being read.
    gathering: HashSet<(String, String)>,
    in_flight: HashMap<String, InFlight>,
    /// A checker session's latest running cost in USD, by checker task.
    costs: HashMap<String, f64>,
    polling: bool,
    poll_again: bool,
    git: GitSource,
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
    KeepersState {
        by_task,
        ..Default::default()
    }
}

impl Daemon {
    pub(crate) async fn handle_keeper_command(&mut self, cmd: KeeperCommand) {
        match cmd {
            KeeperCommand::State { task_id, reply } => {
                let _ = reply.send(self.keeper_task_state(&task_id));
            }
            KeeperCommand::Poll => self.keepers_poll(),
            KeeperCommand::Committed { task_id } => self.keepers_nudge(&task_id),
            KeeperCommand::Polled { results } => self.keepers_polled(results),
            KeeperCommand::Gathered {
                task_id,
                head,
                keepers,
                change,
            } => self.keepers_gathered(&task_id, &head, keepers, change),
            KeeperCommand::Undelivered { run_id, error } => {
                self.keeper_run_failed(&run_id, wire::KeeperOutcome::Error, error);
            }
            KeeperCommand::Deadline { run_id } => self.keeper_deadline(&run_id),
            #[cfg(test)]
            KeeperCommand::Script(git) => self.keepers.git = git,
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

    /// A deleted task takes its checkers with it; a deleted checker fails
    /// the run it was on.
    pub(crate) fn keepers_task_deleted(&mut self, task_id: &str) {
        self.keepers.forget_task(task_id);
        self.keepers.watches.remove(task_id);
        self.keepers.gathering.retain(|(task, _)| task != task_id);
        self.keepers
            .in_flight
            .retain(|_, run| run.task_id != task_id);
        self.keepers.costs.remove(task_id);
        let lost: Vec<String> = self
            .keepers
            .in_flight
            .iter()
            .filter(|(_, run)| run.checker_task_id == task_id)
            .map(|(id, _)| id.clone())
            .collect();
        for run_id in lost {
            let error = "the checker's task was deleted".to_string();
            self.keeper_run_failed(&run_id, wire::KeeperOutcome::Error, error);
        }
        let checkers: Vec<String> = self
            .tasks
            .values()
            .filter(|task| {
                task.origin.as_deref() == Some(KEEPER_ORIGIN)
                    && task.parent_task_id.as_deref() == Some(task_id)
            })
            .map(|task| task.id.clone())
            .collect();
        for id in checkers {
            let cmd_tx = self.cmd_tx.clone();
            tokio::spawn(async move {
                let (reply, _) = oneshot::channel();
                let _ = cmd_tx
                    .send(crate::daemon::actor::Command::DeleteTask { id, reply })
                    .await;
            });
        }
    }
}
