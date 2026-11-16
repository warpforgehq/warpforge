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
use crate::daemon::keepers::{
    list_keepers, ChangeQuery, GitSource, POLL_INTERVAL, QUOTA_SKIP, RESTARTED, SUPERSEDED,
};
use crate::daemon::task::{now_secs, Task, TaskStatus};

const HEAD_READS_AT_ONCE: usize = 8;

/// A task that may have keepers on; whether it does needs the files.
struct Candidate {
    task_id: String,
    project_path: String,
    /// The task's worktree, or the project's checkout.
    cwd: String,
    /// The task has no worktree and shares the project's checkout.
    folder: bool,
    base_branch: Option<String>,
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
    /// Tasks that are not finished, hidden, chats or Factory work (Factory
    /// tasks are out of v1).
    pub(super) fn keeper_candidate(&self, task: &Task) -> bool {
        task.kind.is_task()
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
                    cwd: self.task_repo_path(&task.id)?,
                    folder: task.worktree.is_none(),
                    base_branch: task.base_branch.clone(),
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
        self.keepers_clear_held(&eligible);
        self.keepers
            .watches
            .retain(|task_id, _| eligible.contains(task_id.as_str()));
        self.keepers
            .on
            .retain(|task_id, _| eligible.contains(task_id.as_str()));
        let ready = &self.keepers.ready;
        self.keepers.fixes.retain(|task_id, fix| {
            eligible.contains(task_id.as_str())
                || ready.contains_key(task_id)
                || matches!(fix.phase, super::FixPhase::Sent { .. })
        });
        let polled: Vec<String> = results.iter().map(|r| r.task_id.clone()).collect();
        let now = Instant::now();
        let mut results = results;
        for result in &mut results {
            let task_id = &result.task_id;
            result
                .keepers
                .retain(|d| self.keeper_switched_on(task_id, d));
            self.keepers
                .on
                .insert(result.task_id.clone(), result.keepers.clone());
        }
        let ambiguous_projects = self.keepers_attribute_poll(&results);
        for result in results {
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
            let project = task.project.clone();
            let ambiguous = ambiguous_projects.contains(&project);
            if result.folder {
                self.keepers.folder_heads.insert(project, head.clone());
            }
            self.keepers_supersede(&result.task_id, &head);
            if result.folder
                && !self.keepers_checkout(
                    &result.task_id,
                    result.branch.as_deref(),
                    &head,
                    mid_turn,
                    ambiguous,
                )
            {
                if let Some(watch) = self.keepers.watches.get_mut(&result.task_id) {
                    watch.observe(&head, now, mid_turn);
                }
                continue;
            }
            let read = head.clone();
            self.keepers_edit_task(&result.task_id, |keepers| keepers.head = Some(read));
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
                self.keepers_gather(&result.task_id, head, due, wire::KeeperWhen::Commit);
            }
        }
        for task_id in polled {
            self.keepers_fix(&task_id, None);
        }
        if std::mem::take(&mut self.keepers.poll_again) {
            self.keepers_poll();
        }
    }

    /// The task's switch for the keeper as it stands now; a poll or read in
    /// flight carries the switches from when it started (invariant 21).
    /// @param task_id the task
    /// @param definition the keeper
    /// @returns whether the keeper is on for the task
    pub(super) fn keeper_switched_on(
        &self,
        task_id: &str,
        definition: &wire::KeeperDefinition,
    ) -> bool {
        self.tasks
            .get(task_id)
            .and_then(|task| task.keepers.as_ref())
            .and_then(|keepers| keepers.overrides.get(&definition.id))
            .copied()
            .unwrap_or(definition.default_on)
    }

    /// Not being read or checked already, and its last check was of another
    /// HEAD, was refused by the quota gate or was cut short by a restart.
    pub(super) fn keeper_due(&self, task_id: &str, keeper_id: &str, head: &str) -> bool {
        if self.keeper_busy(task_id, keeper_id) {
            return false;
        }
        match self.keepers.latest_run(task_id, keeper_id) {
            None => true,
            Some(run) => {
                run.head_sha != head
                    || is_quota_skip(run)
                    || run.error.as_deref() == Some(RESTARTED)
            }
        }
    }

    /// Its change is being read, or a checker is on it.
    pub(super) fn keeper_busy(&self, task_id: &str, keeper_id: &str) -> bool {
        let key = (task_id.to_string(), keeper_id.to_string());
        self.keepers.gathering.contains(&key)
            || self
                .keepers
                .in_flight
                .values()
                .any(|run| run.task_id == task_id && run.definition.id == keeper_id)
    }

    pub(super) fn keepers_gather(
        &mut self,
        task_id: &str,
        head: String,
        keepers: Vec<wire::KeeperDefinition>,
        trigger: wire::KeeperWhen,
    ) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let Some(cwd) = self.task_repo_path(task_id) else {
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
                    trigger,
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
                run.error = Some(SUPERSEDED.into());
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
            run.finished_at = Some(now_secs());
            run.error = Some(RESTARTED.into());
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
                // HEAD before the branch: a switch between the reads then holds
                // the task rather than checking another branch's HEAD.
                let head = git.head(&candidate.cwd).await;
                let branch = if candidate.folder {
                    let base = candidate.base_branch.as_deref();
                    git.feature_branch(&candidate.cwd, base).await
                } else {
                    None
                };
                Polled {
                    head,
                    task_id: candidate.task_id,
                    keepers,
                    folder: candidate.folder,
                    branch,
                }
            }
        })
        .buffer_unordered(HEAD_READS_AT_ONCE)
        .collect()
        .await
}
