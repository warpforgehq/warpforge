//! When a keeper runs: the HEAD poll off the actor loop, the settle rule,
//! and superseding a run whose HEAD moved (ADR 0030, *Trigger*).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use futures::StreamExt;
use tokio::sync::mpsc;
use warpforge_protocol as wire;

use super::{KeeperCommand, Polled};
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::keepers::{list_keepers, ChangeQuery, GitSource, POLL_INTERVAL, QUOTA_SKIP};
use crate::daemon::task::{Task, TaskStatus};

const HEAD_READS_AT_ONCE: usize = 8;

/// A task that may have keepers on; whether it does needs the files.
struct Candidate {
    task_id: String,
    project_path: String,
    worktree: String,
    overrides: BTreeMap<String, bool>,
}

/// Ask the actor for a poll every [`POLL_INTERVAL`]. Test daemons drive
/// polls themselves.
/// @param cmd_tx the actor's command channel
pub(crate) fn spawn_poll(cmd_tx: mpsc::Sender<Command>) {
    if cfg!(test) {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(POLL_INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if cmd_tx
                .send(Command::Keepers(KeeperCommand::Poll))
                .await
                .is_err()
            {
                break;
            }
        }
    });
}

impl Daemon {
    /// Worktree tasks that are not finished, hidden, chats or Factory work
    /// (Factory tasks are out of v1).
    pub(super) fn keeper_candidate(&self, task: &Task) -> bool {
        task.kind.is_task()
            && task.worktree.is_some()
            && task.status != TaskStatus::Done
            && task.origin.is_none()
            && task.workflow_run.is_none()
            && !task
                .tags
                .iter()
                .any(|tag| tag == "workflow-stage" || tag.starts_with("workflow:"))
            && self.workflow_child_of(&task.id).is_none()
    }

    /// The task's own turn ended, or Warpforge committed in it: check now.
    pub(crate) fn keepers_nudge(&mut self, task_id: &str) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        if !self.keeper_candidate(task) {
            return;
        }
        self.keepers
            .watches
            .entry(task_id.to_string())
            .or_default()
            .nudge();
        self.keepers_poll();
    }

    /// Read eligible tasks' keeper files and HEADs off the loop.
    pub(super) fn keepers_poll(&mut self) {
        if self.keepers.polling {
            self.keepers.poll_again = true;
            return;
        }
        let candidates: Vec<Candidate> = self
            .tasks
            .values()
            .filter(|task| self.keeper_candidate(task))
            .filter_map(|task| {
                Some(Candidate {
                    task_id: task.id.clone(),
                    project_path: self.project_path(&task.project)?,
                    worktree: task.worktree.clone()?,
                    overrides: task
                        .keepers
                        .as_ref()
                        .map(|k| k.overrides.clone())
                        .unwrap_or_default(),
                })
            })
            .collect();
        if candidates.is_empty() {
            return;
        }
        self.keepers.polling = true;
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            let results = poll(git, candidates).await;
            let _ = cmd_tx
                .send(Command::Keepers(KeeperCommand::Polled { results }))
                .await;
        });
    }

    pub(super) fn keepers_polled(&mut self, results: Vec<Polled>) {
        self.keepers.polling = false;
        self.keepers_sweep_orphans();
        let eligible: HashSet<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
        self.keepers
            .watches
            .retain(|task_id, _| eligible.contains(task_id.as_str()));
        self.keepers
            .on
            .retain(|task_id, _| eligible.contains(task_id.as_str()));
        self.keepers.fixes.retain(|task_id, fix| {
            eligible.contains(task_id.as_str()) || matches!(fix.phase, super::FixPhase::Sent { .. })
        });
        let polled: Vec<String> = results.iter().map(|r| r.task_id.clone()).collect();
        let now = Instant::now();
        for result in results {
            self.keepers
                .on
                .insert(result.task_id.clone(), result.keepers.clone());
            let Some(head) = result.head else {
                continue;
            };
            let Some(task) = self.tasks.get(&result.task_id) else {
                continue;
            };
            if !self.keeper_candidate(task) {
                continue;
            }
            let mid_turn = task.status == TaskStatus::Running;
            self.keepers_supersede(&result.task_id, &head);
            let watch = self
                .keepers
                .watches
                .entry(result.task_id.clone())
                .or_default();
            if !watch.observe(&head, now, mid_turn) {
                continue;
            }
            let due: Vec<wire::KeeperDefinition> = result
                .keepers
                .into_iter()
                .filter(|keeper| self.keeper_due(&result.task_id, &keeper.id, &head))
                .collect();
            if !due.is_empty() {
                self.keepers_gather(&result.task_id, head, due);
            }
        }
        for task_id in polled {
            self.keepers_fix(&task_id, None);
        }
        if std::mem::take(&mut self.keepers.poll_again) {
            self.keepers_poll();
        }
    }

    /// Not being read or checked already, and its last check was of another
    /// HEAD or was refused by the quota gate.
    pub(super) fn keeper_due(&self, task_id: &str, keeper_id: &str, head: &str) -> bool {
        let key = (task_id.to_string(), keeper_id.to_string());
        if self.keepers.gathering.contains(&key) {
            return false;
        }
        let busy = self
            .keepers
            .in_flight
            .values()
            .any(|run| run.task_id == task_id && run.definition.id == keeper_id);
        if busy {
            return false;
        }
        match self.keepers.latest_run(task_id, keeper_id) {
            None => true,
            Some(run) => run.head_sha != head || is_quota_skip(run),
        }
    }

    fn keepers_gather(
        &mut self,
        task_id: &str,
        head: String,
        keepers: Vec<wire::KeeperDefinition>,
    ) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let Some(cwd) = task.worktree.clone() else {
            return;
        };
        for keeper in &keepers {
            self.keepers
                .gathering
                .insert((task_id.to_string(), keeper.id.clone()));
        }
        let query = ChangeQuery {
            cwd,
            base_branch: task.base_branch.clone(),
            head: head.clone(),
            rules: keepers.iter().any(|k| k.prompt.contains("{{rules}}")),
        };
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let change = git.change(&query).await;
            let _ = cmd_tx
                .send(Command::Keepers(KeeperCommand::Gathered {
                    task_id,
                    head,
                    keepers,
                    change,
                }))
                .await;
        });
    }

    /// A run whose HEAD moved stays on display but is never a fix's input
    /// (invariant 4).
    fn keepers_supersede(&mut self, task_id: &str, head: &str) {
        let moved: Vec<String> = self
            .keepers
            .in_flight
            .iter()
            .filter(|(_, run)| run.task_id == task_id && !run.superseded)
            .filter(|(run_id, _)| {
                self.keepers
                    .run(task_id, run_id)
                    .is_some_and(|run| run.head_sha != head)
            })
            .map(|(run_id, _)| run_id.clone())
            .collect();
        for run_id in moved {
            if let Some(flight) = self.keepers.in_flight.get_mut(&run_id) {
                flight.superseded = true;
            }
            if let Some(mut run) = self.keepers.run(task_id, &run_id).cloned() {
                run.error = Some(crate::daemon::keepers::SUPERSEDED.into());
                self.keeper_record(run, Vec::new());
            }
        }
    }

    /// Runs left in flight by a previous daemon never finish; close them.
    fn keepers_sweep_orphans(&mut self) {
        let orphans: Vec<wire::KeeperRun> = self
            .keepers
            .all_runs()
            .filter(|run| run.outcome.is_none())
            .filter(|run| !self.keepers.in_flight.contains_key(&run.id))
            .cloned()
            .collect();
        for mut run in orphans {
            run.outcome = Some(wire::KeeperOutcome::Inconclusive);
            run.finished_at = Some(crate::daemon::task::now_secs());
            run.error = Some("the daemon restarted during the check".into());
            self.keeper_record(run, Vec::new());
        }
    }
}

pub(super) fn is_quota_skip(run: &wire::KeeperRun) -> bool {
    run.outcome == Some(wire::KeeperOutcome::Skipped)
        && run
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with(QUOTA_SKIP))
}

/// Keeper files once per project, then HEADs of the tasks with a commit
/// keeper on, a few at a time.
async fn poll(git: GitSource, candidates: Vec<Candidate>) -> Vec<Polled> {
    let paths: HashSet<String> = candidates.iter().map(|c| c.project_path.clone()).collect();
    let definitions = tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let keepers = list_keepers(Path::new(&path))
                    .into_iter()
                    .filter_map(|entry| entry.definition)
                    .filter(|d| {
                        d.when == wire::KeeperWhen::Commit
                            && d.result != wire::KeeperResultKind::Draft
                    })
                    .collect::<Vec<_>>();
                (path, keepers)
            })
            .collect::<HashMap<_, _>>()
    })
    .await
    .unwrap_or_default();
    let eligible: Vec<(Candidate, Vec<wire::KeeperDefinition>)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            let on: Vec<wire::KeeperDefinition> = definitions
                .get(&candidate.project_path)?
                .iter()
                .filter(|d| {
                    candidate
                        .overrides
                        .get(&d.id)
                        .copied()
                        .unwrap_or(d.default_on)
                })
                .cloned()
                .collect();
            (!on.is_empty()).then_some((candidate, on))
        })
        .collect();
    futures::stream::iter(eligible)
        .map(|(candidate, keepers)| {
            let git = git.clone();
            async move {
                Polled {
                    head: git.head(&candidate.worktree).await,
                    task_id: candidate.task_id,
                    keepers,
                }
            }
        })
        .buffer_unordered(HEAD_READS_AT_ONCE)
        .collect()
        .await
}
