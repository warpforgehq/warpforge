//! A keeper's fix loop on a task: its persisted rounds and stop, what
//! clients are told about it, and what a finished run does to it.

use std::collections::HashSet;

use warpforge_protocol as wire;
use wire::{KeeperFindingStatus as Status, KeeperLoopStatus};

use super::FixPhase;
use crate::daemon::actor::{Daemon, Event};
use crate::daemon::keepers::DEFAULT_MAX_ROUNDS;
use crate::daemon::task::now_secs;

impl Daemon {
    pub(super) fn keeper_loop(&self, task_id: &str, keeper_id: &str) -> wire::KeeperLoop {
        self.tasks
            .get(task_id)
            .and_then(|task| task.keepers.as_ref())
            .and_then(|keepers| keepers.loops.get(keeper_id).cloned())
            .unwrap_or_default()
    }

    /// Write the task's switches and loops, persisting and broadcasting the
    /// task only when they changed.
    pub(super) fn keepers_edit_task(
        &mut self,
        task_id: &str,
        edit: impl FnOnce(&mut wire::TaskKeepers),
    ) {
        let Some(task) = self.tasks.get_mut(task_id) else {
            return;
        };
        let mut keepers = task.keepers.clone().unwrap_or_default();
        edit(&mut keepers);
        keepers
            .loops
            .retain(|_, fix| *fix != wire::KeeperLoop::default());
        let before = task.keepers.clone().unwrap_or_default();
        if before == keepers {
            return;
        }
        let shown = keepers.for_clients();
        let changed_for_clients = before.for_clients() != shown;
        task.keepers = Some(keepers);
        let updated = task.clone();
        self.persist(&updated);
        self.emit(Event::TaskUpdated(updated));
        if changed_for_clients {
            self.emit(Event::TaskKeeperSwitches {
                task_id: task_id.to_string(),
                switches: shown,
            });
        }
    }

    pub(super) fn keeper_set_loop(
        &mut self,
        task_id: &str,
        keeper_id: &str,
        fix: wire::KeeperLoop,
    ) {
        self.keepers_edit_task(task_id, |keepers| {
            keepers.loops.insert(keeper_id.to_string(), fix);
        });
    }

    pub(super) fn keeper_definition(
        &self,
        task_id: &str,
        keeper_id: &str,
    ) -> Option<&wire::KeeperDefinition> {
        let ready = self.keepers.ready.get(task_id).map(|ready| &ready.keepers);
        self.keepers
            .on
            .get(task_id)
            .into_iter()
            .chain(ready)
            .flatten()
            .find(|definition| definition.id == keeper_id)
    }

    pub(super) fn keeper_loop_state(
        &self,
        task_id: &str,
        keeper_id: &str,
    ) -> wire::KeeperLoopState {
        let fix = self.keeper_loop(task_id, keeper_id);
        let max_rounds = self
            .keeper_definition(task_id, keeper_id)
            .map_or(DEFAULT_MAX_ROUNDS, |definition| definition.max_rounds);
        let pending = self
            .keepers
            .fixes
            .get(task_id)
            .filter(|pending| pending.keepers.iter().any(|id| id == keeper_id));
        let latest = self.keepers.latest_run(task_id, keeper_id);
        let (status, reason) = match (&fix.stop, pending.map(|p| &p.phase)) {
            (Some(_), _) => (KeeperLoopStatus::NeedsYou, None),
            (None, Some(FixPhase::Sent { .. })) => (KeeperLoopStatus::Fixing, None),
            (None, Some(FixPhase::Waiting(reason))) => {
                (KeeperLoopStatus::Waiting, Some(reason.clone()))
            }
            (None, Some(FixPhase::Gating)) => (KeeperLoopStatus::Waiting, None),
            (None, None)
                if fix.accepted_head.is_some()
                    && fix.accepted_head.as_deref() == latest.map(|r| r.head_sha.as_str()) =>
            {
                (KeeperLoopStatus::Accepted, None)
            }
            (None, None) => (KeeperLoopStatus::Idle, None),
        };
        wire::KeeperLoopState {
            status,
            reason,
            stop: fix.stop,
            rounds: fix.rounds,
            max_rounds: max_rounds + fix.extra_rounds,
        }
    }

    /// `task.keeper` for the run with `run_id`, its findings and the loop.
    pub(super) fn keeper_emit_run(&mut self, task_id: &str, run_id: &str) {
        let Some(run) = self.keepers.run(task_id, run_id).cloned() else {
            return;
        };
        let findings = self
            .keepers
            .task(task_id)
            .map(|state| {
                let of_run = state.findings.iter().filter(|f| f.run_id == run_id);
                of_run.cloned().collect()
            })
            .unwrap_or_default();
        let state = self.keeper_loop_state(task_id, &run.keeper_id);
        self.emit(Event::TaskKeeper {
            task_id: task_id.to_string(),
            keeper_id: run.keeper_id.clone(),
            run: Box::new(run),
            findings,
            state,
        });
    }

    /// `task.keeper` with the keeper's newest run, after its loop changed.
    pub(super) fn keeper_emit_loop(&mut self, task_id: &str, keeper_id: &str) {
        if let Some(run_id) = self
            .keepers
            .latest_run(task_id, keeper_id)
            .map(|run| run.id.clone())
        {
            self.keeper_emit_run(task_id, &run_id);
        }
    }

    /// A counted run resolves the keeper's sent findings it no longer
    /// reports, and a green one ends the loop's episode.
    pub(super) fn keeper_settle_run(&mut self, task_id: &str, run_id: &str) {
        let Some(run) = self.keepers.run(task_id, run_id).cloned() else {
            return;
        };
        let green = match run.outcome {
            Some(wire::KeeperOutcome::Green) => true,
            Some(wire::KeeperOutcome::Findings) => false,
            _ => return,
        };
        let reported: HashSet<String> = self
            .keepers
            .keeper_findings(task_id, &run.keeper_id)
            .into_iter()
            .filter(|f| f.run_id == run_id)
            .map(|f| f.key.clone())
            .collect();
        let fixed: Vec<wire::KeeperFinding> = self
            .keepers
            .keeper_findings(task_id, &run.keeper_id)
            .into_iter()
            .filter(|f| f.status == Status::Sent && !reported.contains(&f.key))
            .cloned()
            .collect();
        let mut touched: HashSet<String> = HashSet::new();
        for mut finding in fixed {
            finding.status = Status::Fixed;
            finding.resolved_at = Some(now_secs());
            touched.insert(finding.run_id.clone());
            self.keepers
                .put_finding(&self.persist, &self.tasks, task_id, finding);
        }
        for touched_run in touched {
            self.keeper_emit_run(task_id, &touched_run);
        }
        self.keeper_carry_replies(task_id, &run);
        let mut fix = self.keeper_loop(task_id, &run.keeper_id);
        if fix
            .accepted_head
            .as_deref()
            .is_some_and(|head| head != run.head_sha)
        {
            fix.accepted_head = None;
        }
        if green {
            fix = wire::KeeperLoop {
                accepted_head: fix.accepted_head,
                pending_head: fix.pending_head,
                ..Default::default()
            };
        }
        self.keeper_set_loop(task_id, &run.keeper_id, fix);
    }

    /// A finding the run raises again keeps the fixer's pending reply to
    /// its sent predecessor, so the owner still sees it on the latest run.
    fn keeper_carry_replies(&mut self, task_id: &str, run: &wire::KeeperRun) {
        let history = self.keepers.keeper_findings(task_id, &run.keeper_id);
        let carried: Vec<wire::KeeperFinding> = history
            .iter()
            .filter(|f| f.run_id == run.id && f.status == Status::Open && f.reply.is_none())
            .filter_map(|f| {
                let answered = history.iter().find(|old| {
                    old.key == f.key && old.run_id != run.id && old.status == Status::Sent
                });
                let reply = answered?.reply.clone()?;
                Some(wire::KeeperFinding {
                    reply: Some(reply),
                    ..(*f).clone()
                })
            })
            .collect();
        if carried.is_empty() {
            return;
        }
        for finding in carried {
            self.keepers
                .put_finding(&self.persist, &self.tasks, task_id, finding);
        }
        self.keeper_emit_run(task_id, &run.id);
    }
}
