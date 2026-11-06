//! **Send to agent** (ADR 0030, *The fixer*): the owner hands one keeper's
//! open findings to the task's own session, whatever HEAD they were found on.

use std::path::Path;

use warpforge_protocol as wire;
use wire::{KeeperFindingStatus as Status, KeeperOutcome as Outcome};

use super::{Fix, FixPhase, KeeperCommand, Reply};
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::keepers::{list_keepers, owner_fix_prompt, FixItem, SUPERSEDED};

impl Daemon {
    /// Read the keeper's name and whether the worktree is clean off the
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
            let clean = git.quiet(&cwd).await.map(|(_, clean)| clean);
            let read = KeeperCommand::SendRead {
                task_id,
                name: name.unwrap_or_else(|| keeper_id.clone()),
                clean,
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
    /// @param clean whether the worktree had no tracked changes, or why it could not be read
    /// @returns the refusal, if any
    pub(super) fn keepers_send_findings(
        &mut self,
        task_id: &str,
        keeper_id: &str,
        name: &str,
        clean: Result<bool, String>,
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
        let (head, findings) = self.keepers_open_findings(task_id, keeper_id);
        if findings.is_empty() {
            return Err("this keeper has no open findings to send".into());
        }
        if let Some(reason) = self
            .keepers_session_busy(task_id)
            .or_else(|| self.keepers_shared_checkout_busy(task_id))
            .or_else(|| self.keepers_quota_refusal(task_id))
        {
            return Err(reason);
        }
        match clean {
            Ok(true) => {}
            Ok(false) => return Err("the worktree has uncommitted changes".into()),
            Err(error) => return Err(format!("the worktree could not be read: {error}")),
        }
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
        let text = owner_fix_prompt(&head, &items, &guidance);

        let mut next = wire::KeeperLoop {
            stop: None,
            pending_head: Some(head.clone()),
            guidance: None,
            ..fix.clone()
        };
        if next.round_head.as_deref() != Some(head.as_str()) {
            next.rounds += 1;
            next.round_head = Some(head.clone());
        }
        self.keeper_set_loop(task_id, keeper_id, next);
        let replaced = self.keepers.fixes.insert(
            task_id.to_string(),
            Fix {
                head,
                keepers: vec![keeper_id.to_string()],
                phase: FixPhase::Sent {
                    findings: findings.iter().map(|f| f.id.clone()).collect(),
                    prior: vec![(keeper_id.to_string(), fix)],
                },
            },
        );
        for finding in findings {
            let finding = wire::KeeperFinding {
                status: Status::Sent,
                ..finding
            };
            self.keepers
                .put_finding(&self.persist, &self.tasks, task_id, finding);
        }
        let mut told = replaced.map(|old| old.keepers).unwrap_or_default();
        told.retain(|id| id != keeper_id);
        told.push(keeper_id.to_string());
        for id in &told {
            self.keeper_emit_loop(task_id, id);
        }
        self.keepers_fix_send(task_id, text);
        Ok(())
    }

    /// The HEAD of the keeper's latest counted run and its open findings,
    /// as the Keepers tab lists them.
    fn keepers_open_findings(
        &self,
        task_id: &str,
        keeper_id: &str,
    ) -> (String, Vec<wire::KeeperFinding>) {
        let Some(state) = self.keepers.task(task_id) else {
            return (String::new(), Vec::new());
        };
        let last = state
            .runs
            .iter()
            .filter(|run| run.keeper_id == keeper_id)
            .filter(|run| run.outcome.is_some_and(|o| o != Outcome::Skipped))
            .filter(|run| run.error.as_deref() != Some(SUPERSEDED))
            .max_by_key(|run| run.run_number);
        let Some(run) = last.filter(|run| run.outcome == Some(Outcome::Findings)) else {
            return (String::new(), Vec::new());
        };
        let open = state
            .findings
            .iter()
            .filter(|f| f.run_id == run.id && f.status == Status::Open)
            .cloned()
            .collect();
        (run.head_sha.clone(), open)
    }
}
