//! A delivered Factory task's pull request: the daemon asks `PullWatch` to follow it
//! without waiting for a client, and a merge or close ends the attempt.

use tokio::sync::{broadcast, mpsc};

use warpforge_protocol as wire;

use super::{now_secs, RunnerCommand};
use crate::daemon::actor::{Command, Daemon, DaemonHandle, Event};

/// Start the task that registers delivered tasks with `PullWatch` and turns
/// their merged or closed pull requests into [`RunnerCommand::PullSettled`].
/// It keeps only a weak command sender, so a dropped daemon ends it.
/// @param handle the daemon, for its event bus and pull request cache
/// @param mut watch task ids to follow, sent by the actor
pub(crate) fn spawn_pull_bridge(handle: &DaemonHandle, mut watch: mpsc::UnboundedReceiver<String>) {
    let cmd_tx = handle.cmd_tx.downgrade();
    let event_tx = handle.event_tx.clone();
    let pulls = handle.pulls.clone();
    let explorer = handle.explorer.clone();
    let mut events = handle.event_tx.subscribe();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                task_id = watch.recv() => {
                    let Some(task_id) = task_id else { return };
                    let Some(cmd_tx) = cmd_tx.upgrade() else { return };
                    let handle = DaemonHandle {
                        cmd_tx,
                        event_tx: event_tx.clone(),
                        pulls: pulls.clone(),
                        explorer: explorer.clone(),
                    };
                    crate::daemon::pull_status::refresh(&handle, Some(&[task_id]), Some(0)).await;
                }
                event = events.recv() => match event {
                    Ok(Event::TaskPullRequest { task_id, pull_request: Some(pull) })
                        if matches!(pull.state, wire::TaskPullState::Merged | wire::TaskPullState::Closed) =>
                    {
                        let Some(cmd_tx) = cmd_tx.upgrade() else { return };
                        let settled = RunnerCommand::PullSettled { task_id, pull };
                        let _ = cmd_tx.send(Command::Runner(settled)).await;
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                    _ => {}
                },
            }
        }
    });
}

impl Daemon {
    /// Ask the bridge to follow `task_id`'s pull request.
    pub(super) fn runner_watch(&self, task_id: String) {
        if let Some(tx) = self.runner.watch_tx.as_ref() {
            let _ = tx.send(task_id);
        }
    }

    pub(super) async fn runner_pull_settled(&mut self, task_id: &str, pull: wire::TaskPullRequest) {
        let Some(entry) = self.runner.entries.get(task_id).cloned() else {
            return;
        };
        if entry.state != wire::RunnerEntryState::Delivered {
            return;
        }
        let project = entry.project.clone();
        let merged = pull.state == wire::TaskPullState::Merged;
        let run = entry
            .run_id
            .as_ref()
            .and_then(|id| self.runner.runs.get(id).cloned());
        if let Some(mut run) = run {
            let now = now_secs();
            if merged {
                run.outcome = wire::ItemRunOutcome::Merged;
                run.merged_at = Some(now);
            } else {
                run.outcome = wire::ItemRunOutcome::Rejected;
                run.closed_at = Some(now);
                run.detail = Some("the pull request was closed without merging".to_string());
            }
            run.pr_url.get_or_insert(pull.url.clone());
            run.pr_number.get_or_insert(pull.number);
            self.runner_put_run(run, false);
        }
        if merged {
            self.runner_drop_entry(task_id);
            if let Some(item_id) = entry.item_id.as_deref() {
                self.runner_write_item(&project, item_id, "done", None);
            }
        } else {
            self.runner_end_entry(task_id);
        }
        self.runner_emit(&project);
        self.runner_dispatch(&project).await;
    }
}
