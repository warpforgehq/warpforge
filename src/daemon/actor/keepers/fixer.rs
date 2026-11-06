//! The fixer (ADR 0030, *The fixer*, *Concurrency with the user's own work*):
//! once every keeper on a HEAD finished, their open findings go as one prompt
//! into the task's own session, and only into a quiet task.

use tokio::sync::oneshot;
use warpforge_protocol as wire;
use wire::{KeeperFindingStatus as Status, KeeperOutcome as Outcome};

use super::{Fix, FixPhase, KeeperCommand};
use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::keepers::{fix_prompt, meets, stop_rule, FixItem, QUOTA_SKIP, SUPERSEDED};
use crate::daemon::task::TaskStatus;

/// The findings one fix prompt would carry, by keeper.
struct Plan {
    head: String,
    items: Vec<(wire::KeeperDefinition, Vec<wire::KeeperFinding>)>,
}

impl Daemon {
    /// Move the task's fix along: plan it, wait for a quiet task, read the
    /// worktree off the loop, then hand it over. `quiet` is the HEAD the
    /// worktree was just read clean at.
    pub(super) fn keepers_fix(&mut self, task_id: &str, quiet: Option<&str>) {
        if !self.keepers.on.contains_key(task_id) {
            return;
        }
        self.keepers_fix_orphans(task_id);
        if matches!(
            self.keepers.fixes.get(task_id).map(|fix| &fix.phase),
            Some(FixPhase::Gating | FixPhase::Sent { .. })
        ) {
            return;
        }
        let Some(plan) = self.keepers_fix_plan(task_id) else {
            self.keepers_fix_clear(task_id);
            return;
        };
        let keepers: Vec<String> = plan.items.iter().map(|(d, _)| d.id.clone()).collect();
        let phase = match self.keepers_fix_busy(task_id) {
            Some(reason) => FixPhase::Waiting(reason),
            None if quiet == Some(plan.head.as_str()) => {
                self.keepers_fix_dispatch(task_id, plan);
                return;
            }
            None => FixPhase::Gating,
        };
        let unchanged = self.keepers.fixes.get(task_id).is_some_and(|fix| {
            fix.head == plan.head
                && fix.keepers == keepers
                && matches!((&fix.phase, &phase), (FixPhase::Waiting(a), FixPhase::Waiting(b)) if a == b)
        });
        if unchanged {
            return;
        }
        let gate = matches!(phase, FixPhase::Gating).then(|| plan.head.clone());
        let fix = Fix {
            head: plan.head,
            keepers: keepers.clone(),
            phase,
        };
        let mut told = keepers;
        if let Some(old) = self.keepers.fixes.insert(task_id.to_string(), fix) {
            for id in old.keepers {
                if !told.contains(&id) {
                    told.push(id);
                }
            }
        }
        for keeper_id in &told {
            self.keeper_emit_loop(task_id, keeper_id);
        }
        if let Some(head) = gate {
            self.keepers_fix_gate(task_id, head);
        }
    }

    /// Drop a fix that has not been handed over, telling its keepers.
    fn keepers_fix_clear(&mut self, task_id: &str) {
        let removable = self
            .keepers
            .fixes
            .get(task_id)
            .is_some_and(|fix| !matches!(fix.phase, FixPhase::Sent { .. }));
        if !removable {
            return;
        }
        if let Some(fix) = self.keepers.fixes.remove(task_id) {
            for keeper_id in &fix.keepers {
                self.keeper_emit_loop(task_id, keeper_id);
            }
        }
    }

    /// Every keeper on the task finished on its HEAD; each one's open
    /// findings at or above `min_severity`, unless its loop stops here.
    fn keepers_fix_plan(&mut self, task_id: &str) -> Option<Plan> {
        let task = self.tasks.get(task_id)?;
        if !self.keeper_candidate(task) {
            return None;
        }
        let head = self.keepers.watches.get(task_id)?.head()?.to_string();
        let on = self.keepers.on.get(task_id)?.clone();
        for definition in &on {
            let key = (task_id.to_string(), definition.id.clone());
            let busy = self.keepers.gathering.contains(&key)
                || self
                    .keepers
                    .in_flight
                    .values()
                    .any(|run| run.task_id == task_id && run.definition.id == definition.id);
            let latest = self.keepers.latest_run(task_id, &definition.id);
            if busy || !latest.is_some_and(|run| run.head_sha == head && run.outcome.is_some()) {
                return None;
            }
        }
        let mut items = Vec::new();
        for definition in on {
            let fix = self.keeper_loop(task_id, &definition.id);
            if fix.stop.is_some() || fix.accepted_head.as_deref() == Some(head.as_str()) {
                continue;
            }
            let Some(run) = self.keepers.latest_run(task_id, &definition.id).cloned() else {
                continue;
            };
            if run.outcome != Some(Outcome::Findings) {
                continue;
            }
            let history = self.keepers.keeper_findings(task_id, &definition.id);
            let findings: Vec<wire::KeeperFinding> = history
                .iter()
                .filter(|f| f.run_id == run.id && f.status == Status::Open)
                .filter(|f| meets(f.severity, definition.min_severity))
                .map(|f| (*f).clone())
                .collect();
            if findings.is_empty() {
                continue;
            }
            if fix.round_head.as_deref() != Some(head.as_str()) {
                let reraised = findings.iter().any(|f| {
                    history.iter().any(|old| {
                        old.key == f.key && old.run_id != run.id && old.status == Status::Sent
                    })
                });
                let previous = self.keeper_previous_run(task_id, &run);
                if let Some(stop) = stop_rule(&fix, definition.max_rounds, &run, previous, reraised)
                {
                    let stopped = wire::KeeperLoop {
                        stop: Some(stop),
                        ..fix
                    };
                    self.keeper_set_loop(task_id, &definition.id, stopped);
                    self.keeper_emit_loop(task_id, &definition.id);
                    continue;
                }
            }
            items.push((definition, findings));
        }
        (!items.is_empty()).then_some(Plan { head, items })
    }

    /// The keeper's counted run before `run`: one that reached a verdict on
    /// a HEAD it still held.
    fn keeper_previous_run(
        &self,
        task_id: &str,
        run: &wire::KeeperRun,
    ) -> Option<&wire::KeeperRun> {
        self.keepers
            .task(task_id)?
            .runs
            .iter()
            .filter(|r| r.keeper_id == run.keeper_id && r.run_number < run.run_number)
            .filter(|r| matches!(r.outcome, Some(Outcome::Findings | Outcome::Green)))
            .filter(|r| r.error.as_deref() != Some(SUPERSEDED))
            .max_by_key(|r| r.run_number)
    }

    /// Why the task is not quiet enough for a fix prompt (invariant 3), or
    /// out of quota.
    fn keepers_fix_busy(&self, task_id: &str) -> Option<String> {
        let task = self.tasks.get(task_id)?;
        if !self.sessions.contains_key(task_id) && task.session_id.is_none() {
            return Some("the task's agent has no session to resume".into());
        }
        if matches!(
            task.status,
            TaskStatus::Running | TaskStatus::Blocked | TaskStatus::Queued
        ) {
            return Some("the task's agent is working".into());
        }
        if task.queued_prompts.iter().any(|q| q.initiator == "user") {
            return Some("a message of yours is queued".into());
        }
        if let Some(reason) = self.keepers_checkout_busy(task_id) {
            return Some(reason);
        }
        let account = self.spawn_account(task_id);
        self.dispatch_refusal(&task.agent, account)
            .map(|reason| format!("{QUOTA_SKIP}: {reason}"))
    }

    /// `git status --porcelain` and HEAD, off the loop (invariant 12).
    fn keepers_fix_gate(&self, task_id: &str, head: String) {
        let Some(cwd) = self.task_repo_path(task_id) else {
            return;
        };
        let git = self.keepers.git.clone();
        let cmd_tx = self.cmd_tx.clone();
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let quiet = git.quiet(&cwd).await;
            let gated = KeeperCommand::Gated {
                task_id,
                head,
                quiet,
            };
            let _ = cmd_tx.send(Command::Keepers(gated)).await;
        });
    }

    pub(super) fn keepers_fix_gated(
        &mut self,
        task_id: &str,
        head: &str,
        quiet: Result<(String, bool), String>,
    ) {
        let gating = self
            .keepers
            .fixes
            .get(task_id)
            .is_some_and(|fix| fix.head == head && matches!(fix.phase, FixPhase::Gating));
        if !gating {
            return;
        }
        let reason = match quiet {
            Ok((now, true)) if now == head => {
                self.keepers.fixes.remove(task_id);
                self.keepers_fix(task_id, Some(head));
                return;
            }
            Ok((now, _)) if now != head => "HEAD moved; the new commit is checked first".into(),
            Ok(_) => "the worktree has uncommitted changes".into(),
            Err(error) => format!("the worktree could not be read: {error}"),
        };
        if let Some(fix) = self.keepers.fixes.get_mut(task_id) {
            fix.phase = FixPhase::Waiting(reason);
            for keeper_id in fix.keepers.clone() {
                self.keeper_emit_loop(task_id, &keeper_id);
            }
        }
    }

    /// Hand the prompt over: its findings become `sent` and each keeper's
    /// round counts, once per HEAD (invariant 5).
    fn keepers_fix_dispatch(&mut self, task_id: &str, plan: Plan) {
        let mut prior = Vec::new();
        let mut guidance = Vec::new();
        let mut sent = Vec::new();
        for (definition, findings) in &plan.items {
            let fix = self.keeper_loop(task_id, &definition.id);
            if let Some(note) = &fix.guidance {
                guidance.push((definition.name.clone(), note.clone()));
            }
            prior.push((definition.id.clone(), fix.clone()));
            let mut next = fix;
            if next.round_head.as_deref() != Some(plan.head.as_str()) {
                next.rounds += 1;
                next.round_head = Some(plan.head.clone());
            }
            next.pending_head = Some(plan.head.clone());
            next.guidance = None;
            self.keeper_set_loop(task_id, &definition.id, next);
            sent.extend(findings.iter().map(|f| f.id.clone()));
        }
        let items: Vec<FixItem<'_>> = plan
            .items
            .iter()
            .flat_map(|(definition, findings)| {
                findings.iter().map(|finding| FixItem {
                    keeper: &definition.name,
                    finding,
                })
            })
            .collect();
        let notes: Vec<(&str, &str)> = guidance
            .iter()
            .map(|(name, note)| (name.as_str(), note.as_str()))
            .collect();
        let text = fix_prompt(&plan.head, &items, &notes);
        let keepers: Vec<String> = plan.items.iter().map(|(d, _)| d.id.clone()).collect();
        self.keepers.fixes.insert(
            task_id.to_string(),
            Fix {
                head: plan.head.clone(),
                keepers: keepers.clone(),
                phase: FixPhase::Sent {
                    findings: sent,
                    prior,
                },
            },
        );
        for (_, findings) in plan.items {
            for finding in findings {
                let finding = wire::KeeperFinding {
                    status: Status::Sent,
                    ..finding
                };
                self.keepers
                    .put_finding(&self.persist, &self.tasks, task_id, finding);
            }
        }
        for keeper_id in &keepers {
            self.keeper_emit_loop(task_id, keeper_id);
        }
        self.keepers_fix_send(task_id, text);
    }

    fn keepers_fix_send(&self, task_id: &str, text: String) {
        let cmd_tx = self.cmd_tx.clone();
        let task_id = task_id.to_string();
        tokio::spawn(async move {
            let (reply, answer) = oneshot::channel();
            let sent = cmd_tx
                .send(Command::SessionPrompt {
                    task_id: task_id.clone(),
                    text,
                    attachments: Vec::new(),
                    initiator: TurnInitiator::Keeper,
                    peer_message: None,
                    reply,
                })
                .await;
            let error = match (sent, answer.await) {
                (Ok(()), Ok(Ok(()))) => return,
                (_, Ok(Err(error))) => error,
                _ => "the daemon is shutting down".to_string(),
            };
            let undelivered = KeeperCommand::FixUndelivered {
                task_id,
                error: format!("the fix prompt did not reach the task: {error}"),
            };
            let _ = cmd_tx.send(Command::Keepers(undelivered)).await;
        });
    }
}
