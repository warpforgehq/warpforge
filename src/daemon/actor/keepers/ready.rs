//! `when: ready` keepers (ADR 0030, *Trigger*): they run on the owner's
//! explicit request, on the task's HEAD as it is, and never from the poll.

use std::path::Path;

use warpforge_protocol as wire;

use super::checkout::NO_BRANCH;
use super::{KeeperCommand, Ready, Reply};
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::keepers::{list_keepers, MAX_CHECKERS};
use crate::daemon::task::TaskStatus;

/// What a `CheckReady` read off the loop.
#[derive(Debug, Clone)]
pub struct ReadyRead {
    pub head: Option<String>,
    /// For a task without a worktree, the checkout's branch unless it is the base.
    pub branch: Option<String>,
    /// The task's `when: ready` keepers that are on.
    pub keepers: Vec<wire::KeeperDefinition>,
}

impl Daemon {
    /// Read the task's ready keepers, HEAD and branch off the loop; the
    /// reply waits for [`KeeperCommand::ReadyRead`].
    pub(super) fn keepers_check_ready(
        &mut self,
        task_id: &str,
        reply: Reply<(String, Vec<String>)>,
    ) {
        let Some(task) = self.tasks.get(task_id) else {
            let _ = reply.send(Err(format!("unknown task {task_id}")));
            return;
        };
        if !self.keeper_candidate(task) {
            let _ = reply.send(Err("keepers do not run on this task".into()));
            return;
        }
        let (Some(project_path), Some(cwd)) = (
            self.project_path(&task.project),
            self.task_repo_path(task_id),
        ) else {
            let _ = reply.send(Err("the task's checkout is unknown".into()));
            return;
        };
        let folder = task.worktree.is_none();
        let base = task.base_branch.clone();
        let overrides = task
            .keepers
            .as_ref()
            .map(|k| k.overrides.clone())
            .unwrap_or_default();
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let keepers = tokio::task::spawn_blocking(move || {
                list_keepers(Path::new(&project_path))
                    .into_iter()
                    .filter_map(|entry| entry.definition)
                    .filter(|d| d.when == wire::KeeperWhen::Ready)
                    .filter(|d| overrides.get(&d.id).copied().unwrap_or(d.default_on))
                    .collect()
            })
            .await
            .unwrap_or_default();
            let head = git.head(&cwd).await;
            let branch = if folder {
                git.feature_branch(&cwd, base.as_deref()).await
            } else {
                None
            };
            let read = ReadyRead {
                head,
                branch,
                keepers,
            };
            let _ = cmd_tx
                .send(Command::Keepers(KeeperCommand::ReadyRead {
                    task_id,
                    read,
                    reply,
                }))
                .await;
        });
    }

    /// Start the ready keepers not already checking. One that finished on
    /// this HEAD runs again: the request is explicit.
    pub(super) fn keepers_ready_read(
        &mut self,
        task_id: &str,
        read: ReadyRead,
    ) -> Result<(String, Vec<String>), String> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("unknown task {task_id}"))?;
        if !self.keeper_candidate(task) {
            return Err("keepers do not run on this task".into());
        }
        let (folder, mid_turn) = (task.worktree.is_none(), task.status == TaskStatus::Running);
        let head = read.head.ok_or("the task's HEAD could not be read")?;
        if folder {
            if let Some(branch) = &read.branch {
                self.keepers_adopt(task_id, branch);
            }
            if !self.keepers_checkout(task_id, read.branch.as_deref(), &head, mid_turn) {
                let held = self
                    .tasks
                    .get(task_id)
                    .and_then(|task| task.keepers.as_ref())
                    .and_then(|keepers| keepers.held.clone());
                return Err(held.unwrap_or_else(|| NO_BRANCH.to_string()));
            }
        }
        let (busy, start): (Vec<_>, Vec<_>) = read
            .keepers
            .into_iter()
            .partition(|d| self.keeper_busy(task_id, &d.id));
        let mut asked = start.clone();
        asked.extend(
            busy.into_iter()
                .filter(|d| self.keeper_checking(task_id, &d.id, &head)),
        );
        let ready = Ready {
            head: head.clone(),
            keepers: asked,
            queued: Vec::new(),
        };
        self.keepers.ready.insert(task_id.to_string(), ready);
        let started: Vec<String> = start.iter().map(|d| d.id.clone()).collect();
        if !start.is_empty() {
            self.keepers_gather(task_id, head.clone(), start, wire::KeeperWhen::Ready);
        }
        Ok((head, started))
    }

    /// Its change is being read, or its checker is on `head`.
    fn keeper_checking(&self, task_id: &str, keeper_id: &str, head: &str) -> bool {
        let key = (task_id.to_string(), keeper_id.to_string());
        self.keepers.gathering.contains(&key)
            || self.keepers.in_flight.iter().any(|(run_id, run)| {
                run.task_id == task_id
                    && run.definition.id == keeper_id
                    && self
                        .keepers
                        .run(task_id, run_id)
                        .is_some_and(|run| run.head_sha == head)
            })
    }

    /// Start ready keepers that found every checker slot taken.
    pub(super) fn keepers_ready_resume(&mut self) {
        let waiting: Vec<(String, String)> = self
            .keepers
            .ready
            .iter()
            .filter(|(_, ready)| !ready.queued.is_empty())
            .map(|(task_id, ready)| (task_id.clone(), ready.head.clone()))
            .collect();
        for (task_id, head) in waiting {
            if self.keepers.in_flight.len() >= MAX_CHECKERS {
                return;
            }
            let Some(ready) = self.keepers.ready.get_mut(&task_id) else {
                continue;
            };
            let queued = std::mem::take(&mut ready.queued);
            self.keepers_gather(&task_id, head, queued, wire::KeeperWhen::Ready);
        }
    }
}
