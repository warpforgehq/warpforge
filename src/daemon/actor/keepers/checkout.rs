//! Keepers on a task without a worktree (ADR 0030, *Tasks in the project
//! folder*): the task owns the branch its last turn ended on, and its keepers
//! check only while the shared checkout is on that branch.

use std::collections::{HashMap, HashSet};

use warpforge_protocol as wire;

use super::KeeperCommand;
use crate::daemon::actor::Command;
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
    /// @param ambiguous whether this poll's new HEAD has several possible
    /// committers, so nobody may check it yet
    /// @returns whether the task's keepers may check this HEAD
    pub(super) fn keepers_checkout(
        &mut self,
        task_id: &str,
        branch: Option<&str>,
        head: &str,
        mid_turn: bool,
        ambiguous: bool,
    ) -> bool {
        let turn_ended = !mid_turn
            && self
                .keepers
                .watches
                .get(task_id)
                .is_some_and(|watch| watch.nudged());
        let committed = turn_ended && self.keepers_turn_committed(task_id, head);
        if !ambiguous {
            if let Some(branch) = branch {
                if committed || self.keepers_heir(task_id, branch) {
                    self.keepers_claim(task_id, branch);
                }
            }
        }
        let owned = self
            .tasks
            .get(task_id)
            .and_then(|task| task.keepers.as_ref())
            .and_then(|keepers| keepers.branch.clone());
        let held = match (owned, branch) {
            (Some(owned), Some(branch)) if owned == branch => {
                ambiguous.then(|| SHARED_CHECKOUT_BUSY.to_string())
            }
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

    /// Attribute this poll's new HEADs (ADR 0030, *Product shape*): when a
    /// checkout's HEAD moved and exactly one folder task of the project is
    /// mid-turn, that task is the committer and claims the branch at once.
    /// Several mid-turn tasks leave the author ambiguous, so nobody claims and
    /// the owner is held until a later poll resolves it.
    /// @param results one entry per eligible task, as the poll read them
    /// @returns the projects whose new HEAD's author is still ambiguous
    pub(super) fn keepers_attribute_poll(&mut self, results: &[super::Polled]) -> HashSet<String> {
        let mut running: HashMap<String, Vec<String>> = HashMap::new();
        let mut checkout: HashMap<String, (String, String)> = HashMap::new();
        for result in results {
            if !result.folder {
                continue;
            }
            let Some(task) = self.tasks.get(&result.task_id) else {
                continue;
            };
            if task.status == TaskStatus::Running {
                running
                    .entry(task.project.clone())
                    .or_default()
                    .push(result.task_id.clone());
            }
            if let (Some(branch), Some(head)) = (&result.branch, &result.head) {
                checkout
                    .entry(task.project.clone())
                    .or_insert_with(|| (branch.clone(), head.clone()));
            }
        }
        let mut ambiguous = HashSet::new();
        for (project, (branch, head)) in &checkout {
            match self.keepers.attributed_heads.get(project) {
                Some(seen) if seen == head => continue,
                // The first HEAD this daemon sees (a start) has no committer
                // to find; only a move after it is attributed.
                None => {
                    self.keepers
                        .attributed_heads
                        .insert(project.clone(), head.clone());
                    continue;
                }
                Some(_) => {}
            }
            let runners = running.get(project).map(Vec::as_slice).unwrap_or(&[]);
            match runners {
                [_, _, ..] => {
                    ambiguous.insert(project.clone());
                    continue;
                }
                [sole] if self.keepers_running_since_before(sole, head) => {
                    self.keepers_claim(sole, branch);
                }
                // Its turn began after the commit: the committer's turn has
                // ended, and its end claims the branch.
                [_] => {}
                // A hand commit with nobody running stays with the owner.
                [] => {}
            }
            self.keepers
                .attributed_heads
                .insert(project.clone(), head.clone());
        }
        ambiguous
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

    /// The last poll's HEAD can be 20 s old; read the checkout's HEAD now so
    /// a turn that starts right after another session's commit is not taken
    /// for its author.
    pub(super) fn keepers_read_turn_head(&self, task_id: &str) {
        let Some(cwd) = self.task_repo_path(task_id) else {
            return;
        };
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let head = git.head(&cwd).await;
            let read = KeeperCommand::TurnHead { task_id, head };
            let _ = cmd_tx.send(Command::Keepers(read)).await;
        });
    }

    /// Keep the HEAD read at the start of a turn that is still running.
    /// @param task_id the task whose turn started
    /// @param head the checkout's HEAD then, `None` when it could not be read
    pub(super) fn keepers_turn_head(&mut self, task_id: &str, head: Option<String>) {
        let running = self
            .tasks
            .get(task_id)
            .is_some_and(|task| task.status == TaskStatus::Running);
        if let (true, Some(head), Some(start)) =
            (running, head, self.keepers.turn_heads.get_mut(task_id))
        {
            *start = Some(head);
        }
    }

    /// The task's current turn began on another HEAD than `head`, so the
    /// commit can be its own.
    fn keepers_running_since_before(&self, task_id: &str, head: &str) -> bool {
        matches!(self.keepers.turn_heads.get(task_id), Some(Some(start)) if start != head)
    }

    /// Whether the task already owns a branch of the project's checkout.
    fn keepers_has_branch(task: &Task) -> bool {
        task.keepers
            .as_ref()
            .is_some_and(|keepers| keepers.branch.is_some())
    }

    /// Whether the task is a folder task that owns `branch`.
    fn keepers_owns_branch(task: &Task, branch: &str) -> bool {
        task.worktree.is_none()
            && task
                .keepers
                .as_ref()
                .and_then(|keepers| keepers.branch.as_deref())
                == Some(branch)
    }

    /// The folder task sharing `task_id`'s project that owns `branch`.
    /// @param task_id the task whose project to look in
    /// @param branch the branch a folder task may own
    fn keepers_branch_owner(&self, task_id: &str, branch: &str) -> Option<&Task> {
        let task = self.tasks.get(task_id)?;
        self.tasks
            .values()
            .find(|other| other.project == task.project && Self::keepers_owns_branch(other, branch))
    }

    /// No folder task of the project owns `branch`, and `task_id` is the one
    /// that changed last among those with a keeper on and no branch yet.
    fn keepers_heir(&self, task_id: &str, branch: &str) -> bool {
        let Some(task) = self.tasks.get(task_id) else {
            return false;
        };
        if Self::keepers_has_branch(task) {
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
            .any(|other| Self::keepers_owns_branch(other, branch));
        let latest = folder
            .iter()
            .filter(|other| other.keepers.as_ref().is_none_or(|k| k.branch.is_none()))
            .filter(|other| {
                self.keepers
                    .on
                    .get(&other.id)
                    .is_some_and(|on| !on.is_empty())
            })
            // `updated_at` is in seconds, so a turn that just ended and one
            // that started in the same second tie. Prefer the task that is
            // not mid-turn: its last turn ended, which is the later change.
            .max_by_key(|other| {
                (
                    other.updated_at,
                    other.status != TaskStatus::Running,
                    other.id.as_str(),
                )
            })
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
        if Self::keepers_has_branch(task) {
            return;
        }
        if self.keepers_branch_owner(task_id, branch).is_none() {
            self.keepers_claim(task_id, branch);
        }
    }

    /// Shared-checkout descendants attribute their work to the root parent.
    fn keepers_claim_owner(&self, task_id: &str) -> String {
        let mut owner = task_id;
        let mut seen = HashSet::new();
        while let Some(task) = self.tasks.get(owner) {
            if task.worktree.is_some() || !seen.insert(owner) {
                break;
            }
            let Some(parent) = task
                .parent_task_id
                .as_deref()
                .and_then(|id| self.tasks.get(id))
            else {
                break;
            };
            if parent.project != task.project || parent.worktree.is_some() {
                break;
            }
            owner = &parent.id;
        }
        owner.to_string()
    }

    /// The branch moves to `task_id`; other tasks of the project's checkout
    /// that owned it let it go and their open findings are superseded.
    fn keepers_claim(&mut self, task_id: &str, branch: &str) {
        let owner = self.keepers_claim_owner(task_id);
        let task_id = owner.as_str();
        let Some(project) = self.tasks.get(task_id).map(|task| task.project.clone()) else {
            return;
        };
        let previous: Vec<String> = self
            .tasks
            .values()
            .filter(|task| task.id != task_id && task.project == project)
            .filter(|task| Self::keepers_owns_branch(task, branch))
            .map(|task| task.id.clone())
            .collect();
        for other in previous {
            self.keepers_edit_task(&other, |keepers| keepers.branch = None);
            self.keepers_lost_branch(&other);
        }
        self.keepers_edit_task(task_id, |keepers| {
            keepers.branch = Some(branch.to_string());
        });
    }

    /// The task no longer owns its branch: its open findings become
    /// superseded (the new owner's next check reads the whole branch diff and
    /// reports anything still true) and a fix that was not handed over yet is
    /// dropped.
    /// @param task_id the task that lost the branch
    fn keepers_lost_branch(&mut self, task_id: &str) {
        let open: Vec<wire::KeeperFinding> = self
            .keepers
            .task(task_id)
            .map(|state| {
                state
                    .findings
                    .iter()
                    .filter(|finding| finding.status == wire::KeeperFindingStatus::Open)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let mut touched: HashSet<String> = HashSet::new();
        for finding in open {
            touched.insert(finding.run_id.clone());
            let superseded = wire::KeeperFinding {
                status: wire::KeeperFindingStatus::Superseded,
                ..finding
            };
            self.keepers
                .put_finding(&self.persist, &self.tasks, task_id, superseded);
        }
        for run_id in touched {
            self.keeper_emit_run(task_id, &run_id);
        }
        self.keepers_fix_clear(task_id);
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
        self.keepers_shared_checkout_busy(task_id)
    }

    /// Another folder session of the project is mid-turn in the checkout a
    /// folder task shares (invariant 20).
    pub(super) fn keepers_shared_checkout_busy(&self, task_id: &str) -> Option<String> {
        let task = self.tasks.get(task_id)?;
        if task.worktree.is_some() {
            return None;
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
