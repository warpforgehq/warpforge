//! Ending a run: the checker's turn read as a verdict, one re-ask on
//! garbage, and the result written to the mirror and pushed to clients.

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::keepers::{map_result, reask_prompt, Mapped, SUPERSEDED};
use crate::daemon::task::now_secs;

impl Daemon {
    /// Mirror, write-behind, then `task.keeper` with the run's findings.
    pub(super) fn keeper_record(
        &mut self,
        run: wire::KeeperRun,
        findings: Vec<wire::KeeperFinding>,
    ) {
        let (task_id, run_id) = (run.task_id.clone(), run.id.clone());
        self.keepers.put_run(&self.persist, &self.tasks, run);
        for finding in findings {
            self.keepers
                .put_finding(&self.persist, &self.tasks, &task_id, finding);
        }
        self.keeper_emit_run(&task_id, &run_id);
    }

    fn keeper_flight_of(&self, checker: &str) -> Option<String> {
        self.keepers
            .in_flight
            .iter()
            .find(|(_, run)| run.checker_task_id == checker)
            .map(|(id, _)| id.clone())
    }

    pub(crate) fn keepers_turn_started(&mut self, task_id: &str) {
        if let Some(task) = self.tasks.get(task_id).filter(|t| t.worktree.is_none()) {
            let head = self.keepers.folder_heads.get(&task.project).cloned();
            self.keepers.turn_heads.insert(task_id.to_string(), head);
        }
        let Some(run_id) = self.keeper_flight_of(task_id) else {
            return;
        };
        if let Some(run) = self.keepers.in_flight.get_mut(&run_id) {
            run.started |= run.dispatched;
        }
    }

    pub(crate) fn keepers_usage(&mut self, task_id: &str, cost: Option<&wire::SessionUsageCost>) {
        let Some(cost) = cost.filter(|cost| cost.currency == "USD") else {
            return;
        };
        if self.keeper_parent_of(task_id).is_some() {
            self.keepers.costs.insert(task_id.to_string(), cost.amount);
        }
    }

    /// A checker's turn is its run's result; the task's own turn asks for a
    /// check and lets a waiting fix try again.
    pub(crate) fn keepers_turn_ended(&mut self, task_id: &str, success: bool, interrupted: bool) {
        if self.keeper_parent_of(task_id).is_none() {
            // A fix is sent only into an idle session, so the first turn to end
            // after it is the fix turn, whatever initiator the harness reported.
            self.keepers_fix_ended(task_id, success && !interrupted);
            if !interrupted {
                self.keepers_nudge(task_id);
            }
            self.keepers_fix(task_id, None);
            return;
        }
        if interrupted {
            return;
        }
        let Some(run_id) = self.keeper_flight_of(task_id) else {
            return;
        };
        let Some(flight) = self.keepers.in_flight.get(&run_id) else {
            return;
        };
        if !flight.started {
            return;
        }
        if !success {
            let error = "the checker's agent stopped before answering".to_string();
            self.keeper_run_failed(&run_id, wire::KeeperOutcome::Inconclusive, error);
            return;
        }
        let (id, kind, min) = (
            flight.definition.id.clone(),
            flight.definition.result,
            flight.definition.min_severity,
        );
        let (reasked, checker) = (flight.reasked, flight.checker_task_id.clone());
        let text = self.collect_stage_text(task_id);
        let text = match kind {
            wire::KeeperResultKind::Draft => text.closing,
            _ => text.full,
        };
        match map_result(&id, kind, min, &text) {
            Ok(mapped) => self.keeper_finish(&run_id, mapped),
            Err(reason) if !reasked => {
                let prompt = reask_prompt(kind, &reason);
                if let Some(flight) = self.keepers.in_flight.get_mut(&run_id) {
                    flight.reasked = true;
                    flight.started = false;
                }
                self.keeper_prompt(&run_id, checker, prompt);
            }
            Err(reason) => {
                let error = format!("no readable verdict: {reason}");
                self.keeper_run_failed(&run_id, wire::KeeperOutcome::Inconclusive, error);
            }
        }
    }

    /// The checker's session died, or the task's own during a fix turn.
    pub(crate) fn keepers_session_failed(&mut self, task_id: &str, reason: &str) {
        let error = format!("the task's agent failed: {reason}");
        self.keepers_fix_revert(task_id, Some(error));
        if let Some(run_id) = self.keeper_flight_of(task_id) {
            let error = format!("the checker failed: {reason}");
            self.keeper_run_failed(&run_id, wire::KeeperOutcome::Error, error);
        }
    }

    pub(super) fn keeper_run_failed(
        &mut self,
        run_id: &str,
        outcome: wire::KeeperOutcome,
        error: String,
    ) {
        self.keeper_finish(
            run_id,
            Mapped {
                outcome,
                count: 0,
                findings: Vec::new(),
                error: Some(error),
                draft: None,
            },
        );
    }

    fn keeper_finish(&mut self, run_id: &str, mapped: Mapped) {
        let Some(flight) = self.keepers.in_flight.remove(run_id) else {
            return;
        };
        let Some(mut run) = self.keepers.run(&flight.task_id, run_id).cloned() else {
            return;
        };
        let now = self.keepers.costs.get(&flight.checker_task_id).copied();
        run.cost = match (flight.baseline_cost, now) {
            (_, None) => None,
            (Some(before), Some(now)) if now >= before => Some(now - before),
            (_, now) => now,
        }
        .map(|amount| wire::SessionUsageCost {
            amount,
            currency: "USD".into(),
        });
        run.finished_at = Some(now_secs());
        run.count = mapped.count;
        run.outcome = Some(mapped.outcome);
        run.error = mapped.error;
        run.draft = mapped.draft;
        let status = if flight.superseded {
            run.outcome = Some(wire::KeeperOutcome::Skipped);
            run.error = Some(SUPERSEDED.into());
            wire::KeeperFindingStatus::Superseded
        } else {
            wire::KeeperFindingStatus::Open
        };
        let findings = mapped
            .findings
            .into_iter()
            .map(|finding| wire::KeeperFinding {
                id: format!("kf_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
                run_id: run_id.to_string(),
                status,
                ..finding
            })
            .collect();
        self.keeper_record(run, findings);
        if !flight.superseded {
            self.keeper_settle_run(&flight.task_id, run_id);
        }
        self.keepers_fix(&flight.task_id, None);
        self.keepers_ready_resume();
        self.keepers_poll();
    }
}
