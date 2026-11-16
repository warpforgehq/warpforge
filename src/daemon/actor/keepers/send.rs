//! **Send to agent** (ADR 0030, *The fixer*): the owner hands one keeper's
//! open findings to the task's own session, whatever HEAD they were found on.

use std::path::Path;

use warpforge_protocol as wire;
use wire::{KeeperFindingStatus as Status, KeeperOutcome as Outcome};

use super::{FixPhase, KeeperCommand, Reply};
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::keepers::{list_keepers, owner_fix_prompt, FixItem};

impl Daemon {
    /// Read the keeper's name and the worktree's changed files off the
    /// loop; the reply waits for [`KeeperCommand::SendRead`].
    /// @param task_id the task whose agent gets the findings
    /// @param keeper_id the keeper whose findings are sent
    /// @param reply gets the refusal, if any
    pub(super) fn keepers_send_read(&mut self, task_id: &str, keeper_id: &str, reply: Reply<()>) {
        let Some(task) = self.tasks.get(task_id) else {
            let _ = reply.send(Err(format!("unknown task {task_id}")));
            return;
        };
        let project_path = self.project_path(&task.project);
        let Some(cwd) = self.task_repo_path(task_id) else {
            let _ = reply.send(Err("the task's checkout is unknown".into()));
            return;
        };
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        let (task_id, keeper_id) = (task_id.to_string(), keeper_id.to_string());
        tokio::spawn(async move {
            let id = keeper_id.clone();
            let name = tokio::task::spawn_blocking(move || {
                list_keepers(Path::new(&project_path?))
                    .into_iter()
                    .filter_map(|entry| entry.definition)
                    .find(|definition| definition.id == id)
                    .map(|definition| definition.name)
            })
            .await
            .ok()
            .flatten();
            let changed = git.changed_files(&cwd).await;
            let read = KeeperCommand::SendRead {
                task_id,
                name: name.unwrap_or_else(|| keeper_id.clone()),
                changed,
                keeper_id,
                reply,
            };
            let _ = cmd_tx.send(Command::Keepers(read)).await;
        });
    }

    /// Send the open findings of the keeper's latest counted run as one
    /// `Keeper` turn; refused while the task's session is not free.
    /// @param task_id the task whose agent gets the findings
    /// @param keeper_id the keeper whose findings are sent
    /// @param name the keeper's name, as the prompt shows it
    /// @param changed the worktree's files with uncommitted changes, or why it could not be read
    /// @returns the refusal, if any
    pub(super) fn keepers_send_findings(
        &mut self,
        task_id: &str,
        keeper_id: &str,
        name: &str,
        changed: Result<Vec<String>, String>,
    ) -> Result<(), String> {
        if !self.tasks.contains_key(task_id) {
            return Err(format!("unknown task {task_id}"));
        }
        let sent = self
            .keepers
            .fixes
            .get(task_id)
            .is_some_and(|fix| matches!(fix.phase, FixPhase::Sent { .. }));
        if sent {
            return Err("the task's agent is already fixing keeper findings".into());
        }
        let Some((head, findings)) = self
            .keepers_open_findings(task_id, keeper_id)
            .filter(|(_, findings)| !findings.is_empty())
        else {
            return Err("this keeper has no open findings to send".into());
        };
        if let Some(reason) = self
            .keepers_session_busy(task_id)
            .or_else(|| self.keepers_shared_checkout_busy(task_id))
            .or_else(|| self.keepers_quota_refusal(task_id))
        {
            return Err(reason);
        }
        let changed =
            changed.map_err(|error| format!("the worktree could not be read: {error}"))?;
        let mut touched: Vec<&str> = findings
            .iter()
            .filter_map(|f| f.file.as_deref())
            .map(|file| file.trim_start_matches("./"))
            .filter(|file| changed.iter().any(|c| c == file))
            .collect();
        touched.sort_unstable();
        touched.dedup();
        if !touched.is_empty() {
            return Err(format!(
                "{} has uncommitted changes; commit or stash them first so the fix does not take \
them with it",
                touched.join(", ")
            ));
        }
        let dirty = !changed.is_empty();
        let fix = self.keeper_loop(task_id, keeper_id);
        let guidance: Vec<(&str, &str)> = fix
            .guidance
            .as_deref()
            .map(|note| (name, note))
            .into_iter()
            .collect();
        let items: Vec<FixItem<'_>> = findings
            .iter()
            .map(|finding| FixItem {
                keeper: name,
                finding,
            })
            .collect();
        let text = owner_fix_prompt(&head, &items, &guidance, dirty);
        let sent = vec![(keeper_id.to_string(), findings)];
        self.keepers_fix_hand_over(task_id, head, sent, text);
        Ok(())
    }

    /// The HEAD of the keeper's latest counted run and its open findings,
    /// as the Keepers tab lists them, with the sent ones the agent answered:
    /// sending those again is how the owner rejects the answer.
    fn keepers_open_findings(
        &self,
        task_id: &str,
        keeper_id: &str,
    ) -> Option<(String, Vec<wire::KeeperFinding>)> {
        let state = self.keepers.task(task_id)?;
        let run = self
            .keepers
            .latest_counted_run(task_id, keeper_id)
            .filter(|run| run.outcome == Some(Outcome::Findings))?;
        let open = state
            .findings
            .iter()
            .filter(|f| f.run_id == run.id)
            .filter(|f| f.status == Status::Open || (f.status == Status::Sent && f.reply.is_some()))
            .cloned()
            .collect();
        Some((run.head_sha.clone(), open))
    }
}
