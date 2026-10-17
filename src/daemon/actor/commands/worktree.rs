use warpforge_protocol as wire;

use crate::daemon::actor::lifecycle::apply_lifecycle_action;
use crate::daemon::actor::lifecycle::LifecycleAction;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::workflow::WorkflowOutcome;

impl Daemon {
    pub(crate) async fn handle_worktree_command(&mut self, cmd: Command) {
        match cmd {
            Command::MergeWorktree {
                task_id,
                remove_worktree,
                reply,
            } => {
                // A turn in flight owns the checkout's working tree; merging
                // (and removing it) out from under the agent is not safe.
                if self
                    .tasks
                    .get(&task_id)
                    .is_some_and(|t| t.status == crate::daemon::task::TaskStatus::Running)
                {
                    let _ = reply.send(Err("wait for the agent to finish its turn".into()));
                    return;
                }
                // Merging runs git commands and possibly removes a checkout.
                // Resolve what they need here, run them off the loop, and
                // record the outcome through Command::WorktreeMerged (ADR 0002).
                let resolved = self
                    .tasks
                    .get(&task_id)
                    .map(|t| t.project.clone())
                    .and_then(|project| {
                        let mgr = self.worktrees.get(&project)?;
                        let wt = mgr.get(&task_id)?;
                        Some((
                            mgr.base_repo().to_path_buf(),
                            wt.path.clone(),
                            wt.branch.clone(),
                            wt.base_branch.clone(),
                        ))
                    });
                let Some((base_repo, path, branch, base_branch)) = resolved else {
                    let _ = reply.send(Err(format!("no worktree for task {task_id}")));
                    return;
                };
                let cmd_tx = self.cmd_tx.clone();
                tokio::spawn(async move {
                    use crate::daemon::worktree::MergeResult;
                    let merged = crate::daemon::worktree::merge_detached(
                        &base_repo,
                        &path,
                        &branch,
                        &base_branch,
                    )
                    .await;
                    let (message, remove) = match merged {
                        Ok(MergeResult::FastForward { branch }) => (
                            format!("Fast-forwarded {base_branch} to {branch}"),
                            remove_worktree,
                        ),
                        Ok(MergeResult::Merged { branch, commit }) => {
                            let short = &commit[..commit.len().min(7)];
                            (
                                format!("Merged {branch} into {base_branch} ({short})"),
                                remove_worktree,
                            )
                        }
                        Ok(MergeResult::Conflict { files, message }) => {
                            let detail = if files.is_empty() {
                                message
                            } else {
                                format!("{message}\n{}", files.join("\n"))
                            };
                            let _ = reply.send(Err(format!(
                                "Merge conflict. Update the task branch from {base_branch} first.\n{detail}"
                            )));
                            return;
                        }
                        Ok(MergeResult::Refused(reason)) => {
                            let _ = reply.send(Err(reason));
                            return;
                        }
                        Ok(MergeResult::Error(msg)) => {
                            let _ = reply.send(Err(msg));
                            return;
                        }
                        Err(e) => {
                            let _ = reply.send(Err(format!("{e:#}")));
                            return;
                        }
                    };
                    if remove {
                        // The actor stops the task's terminals and session
                        // before the checkout goes away, then removes it.
                        let _ = cmd_tx
                            .send(Command::WorktreeMerged {
                                task_id,
                                message,
                                reply,
                            })
                            .await;
                    } else {
                        let _ = reply.send(Ok(message));
                    }
                });
            }
            Command::WorktreeMerged {
                task_id,
                message,
                reply,
            } => {
                self.discard_worktree(&task_id).await;
                if let Some(task) = self.tasks.get_mut(&task_id) {
                    task.set_status(crate::daemon::task::TaskStatus::Done);
                    let updated = task.clone();
                    self.persist(&updated);
                    self.emit(Event::TaskUpdated(updated));
                }
                let _ = reply.send(Ok(message));
            }
            Command::DiscardWorktree { task_id } => {
                self.discard_worktree(&task_id).await;
                if let Some(task) = self.tasks.get(&task_id) {
                    let updated = task.clone();
                    self.persist(&updated);
                    self.emit(Event::TaskUpdated(updated));
                }
            }
            Command::WorktreeReady { task_id, created } => {
                // Record the checkout even if nobody is waiting for it any
                // more: the directory exists on disk either way, and a
                // worktree the manager does not know about is one nothing can
                // clean up later.
                let mut setup_error = None;
                match created {
                    Ok((project, wt, setup)) => {
                        setup_error = setup;
                        if let Some(task) = self.tasks.get_mut(&task_id) {
                            task.worktree = Some(wt.path.to_string_lossy().to_string());
                            task.base_branch = Some(wt.base_branch.clone());
                            let updated = task.clone();
                            self.persist(&updated);
                            self.emit(Event::TaskUpdated(updated));
                        }
                        if let Some(mgr) = self.worktrees.get_mut(&project) {
                            mgr.adopt(wt);
                        }
                    }
                    Err(error) => {
                        // Surface the failure instead of running unisolated; a
                        // task cancelled mid-checkout has no pending entry, so
                        // it is left alone.
                        if self.pending_workflow_starts.remove(&task_id).is_some() {
                            let _ = self
                                .workflow_finalize(
                                    &task_id,
                                    WorkflowOutcome::Error(format!(
                                        "could not create an isolated worktree: {error}"
                                    )),
                                )
                                .await;
                        } else if let Some(start) = self.pending_session_starts.remove(&task_id) {
                            // Keep the original start so a retry has the task.
                            self.blocked_starts.insert(task_id.clone(), start);
                            self.worktree_failed(&task_id, &error);
                        }
                    }
                }
                if let Some(error) = setup_error {
                    if self.pending_workflow_starts.remove(&task_id).is_some() {
                        let _ = self
                            .workflow_finalize(
                                &task_id,
                                WorkflowOutcome::Error(format!("worktree setup failed: {error}")),
                            )
                            .await;
                    } else if let Some(start) = self.pending_session_starts.remove(&task_id) {
                        self.blocked_starts.insert(task_id.clone(), start);
                        self.worktree_setup_failed(&task_id, &error);
                    }
                }
                // The pending entry is the token: cancelling or deleting the
                // task removes it, so a checkout that lands afterwards must not
                // start a session for it (ADR 0002 invariant 5).
                if let Some(start) = self.pending_session_starts.remove(&task_id) {
                    self.start_pending_session(&task_id, start);
                }
                if let Some(stage) = self.pending_workflow_starts.remove(&task_id) {
                    self.workflow_spawn_stage(&task_id, stage).await;
                }
            }
            #[cfg(test)]
            Command::SetWorktreeRemover { remover } => {
                self.remove_worktree = remover;
            }
            Command::ListWorktrees { project, reply } => {
                let wts = if let Some(wt_mgr) = self.worktrees.get(&project) {
                    wt_mgr
                        .list()
                        .into_iter()
                        .map(|wt| wire::WorktreeInfo {
                            task_id: wt.task_id.clone(),
                            path: wt.path.to_string_lossy().to_string(),
                            branch: wt.branch.clone(),
                            base_branch: wt.base_branch.clone(),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                let _ = reply.send(wts);
            }
            Command::SettleTask { task_id, reply } => {
                let result = match self.tasks.get(&task_id) {
                    None => Err(format!("unknown task {task_id}")),
                    Some(task) => {
                        let now = crate::daemon::task::now_secs();
                        let has_pending = self.has_pending_permission(&task_id);
                        match apply_lifecycle_action(
                            task,
                            has_pending,
                            now,
                            LifecycleAction::Settle,
                        ) {
                            Ok(Some(updated)) => {
                                self.persist(&updated);
                                self.tasks.insert(task_id.clone(), updated.clone());
                                self.emit(Event::TaskUpdated(updated));
                                self.smith_task_settled(&task_id);
                                self.smith_report_back(&task_id);
                                Ok(())
                            }
                            Ok(None) => Ok(()), // true no-op
                            Err(e) => Err(e),
                        }
                    }
                };
                let _ = reply.send(result);
            }
            Command::UnsettleTask { task_id, reply } => {
                let result = match self.tasks.get(&task_id) {
                    None => Err(format!("unknown task {task_id}")),
                    Some(task) => {
                        let now = crate::daemon::task::now_secs();
                        let has_pending = self.has_pending_permission(&task_id);
                        match apply_lifecycle_action(
                            task,
                            has_pending,
                            now,
                            LifecycleAction::Unsettle,
                        ) {
                            Ok(Some(updated)) => {
                                self.persist(&updated);
                                self.tasks.insert(task_id.clone(), updated.clone());
                                self.emit(Event::TaskUpdated(updated));
                                Ok(())
                            }
                            Ok(None) => Ok(()), // true no-op
                            Err(e) => Err(e),
                        }
                    }
                };
                let _ = reply.send(result);
            }
            Command::SnoozeTask {
                task_id,
                until,
                reply,
            } => {
                let result = match self.tasks.get(&task_id) {
                    None => Err(format!("unknown task {task_id}")),
                    Some(task) => {
                        let now = crate::daemon::task::now_secs();
                        let has_pending = self.has_pending_permission(&task_id);
                        match apply_lifecycle_action(
                            task,
                            has_pending,
                            now,
                            LifecycleAction::Snooze { until },
                        ) {
                            Ok(Some(updated)) => {
                                self.persist(&updated);
                                self.tasks.insert(task_id.clone(), updated.clone());
                                self.emit(Event::TaskUpdated(updated));
                                Ok(())
                            }
                            Ok(None) => Ok(()), // true no-op
                            Err(e) => Err(e),
                        }
                    }
                };
                let _ = reply.send(result);
            }
            Command::UnsnoozeTask { task_id, reply } => {
                let result = match self.tasks.get(&task_id) {
                    None => Err(format!("unknown task {task_id}")),
                    Some(task) => {
                        let now = crate::daemon::task::now_secs();
                        let has_pending = self.has_pending_permission(&task_id);
                        match apply_lifecycle_action(
                            task,
                            has_pending,
                            now,
                            LifecycleAction::Unsnooze,
                        ) {
                            Ok(Some(updated)) => {
                                self.persist(&updated);
                                self.tasks.insert(task_id.clone(), updated.clone());
                                self.emit(Event::TaskUpdated(updated));
                                Ok(())
                            }
                            Ok(None) => Ok(()), // true no-op
                            Err(e) => Err(e),
                        }
                    }
                };
                let _ = reply.send(result);
            }

            other => self.handle_git_command(other).await,
        }
    }

    /// Stop everything that lives in a task's checkout, in DeleteTask's order
    /// (terminals, then the session), then remove it off the loop (ADR 0002)
    /// and point the task at no checkout. The caller persists and emits.
    async fn discard_worktree(&mut self, task_id: &str) {
        for terminal_id in self.agents.kill_for_task(task_id) {
            self.emit(Event::AgentExited { id: terminal_id });
        }
        if let Some(handle) = self.drop_session(task_id) {
            let _ = handle.cancel_and_wait().await;
        }
        if let Some((project, base_repo, path, branch)) = self.worktree_for_removal(task_id) {
            if let Some(mgr) = self.worktrees.get_mut(&project) {
                mgr.forget(task_id);
            }
            self.spawn_worktree_removal(base_repo, path, branch, task_id.to_string());
        }
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.worktree = None;
            task.base_branch = None;
            // The session lived in the removed checkout; clearing the id
            // stops a later resume from starting in a deleted cwd.
            task.session_id = None;
        }
    }
}
