//! Keepers on a task without a worktree (ADR 0030, *Tasks in the project
//! folder*): the task owns the branch its last turn ended on, and its keepers
//! check only while the shared checkout is on that branch.

use std::collections::HashSet;

use crate::daemon::actor::Daemon;
use crate::daemon::task::{Task, TaskStatus};

pub(crate) const NO_BRANCH: &str =
    "keepers start when this task's turn ends on a branch other than the base";
pub(crate) const SHARED_CHECKOUT_BUSY: &str = "another session is working in this checkout";

impl Daemon {
    /// Claim the branch when the task's turn just ended on it, or when it is
    /// the branch's heir, then say whether the checkout is on its branch.
    /// @param task_id a task without a worktree
    /// @param branch the checkout's branch, `None` on the base or detached
    /// @param head the checkout's HEAD
    /// @param mid_turn whether the task's agent is working
    /// @returns whether the task's keepers may check this HEAD
    pub(super) fn keepers_checkout(
        &mut self,
        task_id: &str,
        branch: Option<&str>,
        head: &str,
        mid_turn: bool,
    ) -> bool {
        let turn_ended = !mid_turn
            && self
                .keepers
                .watches
                .get(task_id)
                .is_some_and(|watch| watch.nudged());
        let committed = turn_ended && self.keepers_turn_committed(task_id, head);
        if let Some(branch) = branch {
            if committed || self.keepers_heir(task_id, branch) {
                self.keepers_claim(task_id, branch);
            }
        }
        let owned = self
            .tasks
            .get(task_id)
            .and_then(|task| task.keepers.as_ref())
            .and_then(|keepers| keepers.branch.clone());
        let held = match (owned, branch) {
            (Some(owned), Some(branch)) if owned == branch => None,
            (Some(owned), Some(branch)) => {
                Some(format!("the checkout is on {branch}, not {owned}"))
            }
            (Some(owned), None) => Some(format!("the checkout is not on {owned}")),
            (None, _) => Some(NO_BRANCH.to_string()),
        };
        let checks = held.is_none();
        self.keepers_edit_task(task_id, |keepers| keepers.held = held);
        checks
    }

    /// The turn that just ended moved the checkout's HEAD, or Warpforge
    /// committed for the task outside a turn.
    fn keepers_turn_committed(&mut self, task_id: &str, head: &str) -> bool {
        self.keepers
            .turn_heads
            .remove(task_id)
            .flatten()
            .is_none_or(|start| start != head)
    }

    /// No folder task of the project owns `branch`, and `task_id` is the one
    /// that changed last among those with a keeper on and no branch yet.
    fn keepers_heir(&self, task_id: &str, branch: &str) -> bool {
        let Some(task) = self.tasks.get(task_id) else {
            return false;
        };
        if task.keepers.as_ref().is_some_and(|k| k.branch.is_some()) {
            return false;
        }
        let folder: Vec<&Task> = self
            .tasks
            .values()
            .filter(|other| other.project == task.project && other.worktree.is_none())
            .filter(|other| self.keeper_candidate(other))
            .collect();
        let owned = folder
            .iter()
            .any(|other| other.keepers.as_ref().and_then(|k| k.branch.as_deref()) == Some(branch));
        let latest = folder
            .iter()
            .filter(|other| other.keepers.as_ref().is_none_or(|k| k.branch.is_none()))
            .filter(|other| {
                self.keepers
                    .on
                    .get(&other.id)
                    .is_some_and(|on| !on.is_empty())
            })
            .max_by_key(|other| (other.updated_at, other.id.as_str()))
            .map(|other| other.id.as_str());
        !owned && latest == Some(task_id)
    }

    /// An explicit check claims a branch no folder task of the project owns,
    /// for a task that owns none yet.
    /// @param task_id a task without a worktree
    /// @param branch the checkout's branch
    pub(super) fn keepers_adopt(&mut self, task_id: &str, branch: &str) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        if task.keepers.as_ref().is_some_and(|k| k.branch.is_some()) {
            return;
        }
        let owned = self.tasks.values().any(|other| {
            other.project == task.project
                && other.worktree.is_none()
                && other.keepers.as_ref().and_then(|k| k.branch.as_deref()) == Some(branch)
        });
        if !owned {
            self.keepers_claim(task_id, branch);
        }
    }

    /// The branch moves to `task_id`; other tasks of the project's checkout
    /// that owned it let it go.
    fn keepers_claim(&mut self, task_id: &str, branch: &str) {
        let Some(project) = self.tasks.get(task_id).map(|task| task.project.clone()) else {
            return;
        };
        let previous: Vec<String> = self
            .tasks
            .values()
            .filter(|task| task.id != task_id && task.project == project)
            .filter(|task| task.worktree.is_none())
            .filter(|task| {
                task.keepers
                    .as_ref()
                    .and_then(|keepers| keepers.branch.as_deref())
                    == Some(branch)
            })
            .map(|task| task.id.clone())
            .collect();
        for other in previous {
            self.keepers_edit_task(&other, |keepers| keepers.branch = None);
        }
        self.keepers_edit_task(task_id, |keepers| {
            keepers.branch = Some(branch.to_string());
        });
    }

    /// A task no poll covers any more keeps no stale reason.
    pub(super) fn keepers_clear_held(&mut self, polled: &HashSet<&str>) {
        let stale: Vec<String> = self
            .tasks
            .values()
            .filter(|task| !polled.contains(task.id.as_str()))
            .filter(|task| task.keepers.as_ref().is_some_and(|k| k.held.is_some()))
            .map(|task| task.id.clone())
            .collect();
        for task_id in stale {
            self.keepers_edit_task(&task_id, |keepers| keepers.held = None);
        }
    }

    /// Why a fix may not go into a task's checkout yet: it is held, or
    /// another session works in the same shared checkout.
    pub(super) fn keepers_checkout_busy(&self, task_id: &str) -> Option<String> {
        let task = self.tasks.get(task_id)?;
        if task.worktree.is_some() {
            return None;
        }
        if let Some(held) = task.keepers.as_ref().and_then(|k| k.held.clone()) {
            return Some(held);
        }
        let shared = self.tasks.values().any(|other| {
            other.id != task.id
                && other.project == task.project
                && other.worktree.is_none()
                && other.kind.is_task()
                && other.origin.is_none()
                && other.status == TaskStatus::Running
        });
        shared.then(|| SHARED_CHECKOUT_BUSY.to_string())
    }
}
