//! The owner's verdicts: dismissing a finding, answering a stopped loop, and
//! the per-task switch (ADR 0030, *Result model*, *Cost, stop rules,
//! escalation*).

use warpforge_protocol as wire;
use wire::{KeeperDecision, KeeperFindingStatus as Status};

use crate::daemon::actor::Daemon;
use crate::daemon::keepers::MAX_ROUNDS_CAP;
use crate::daemon::task::now_secs;

const GUIDANCE_MAX_CHARS: usize = 2000;

impl Daemon {
    pub(super) fn keepers_dismiss(
        &mut self,
        task_id: &str,
        finding_id: &str,
        reason: Option<String>,
    ) -> Result<(), String> {
        let finding = self
            .keepers
            .task(task_id)
            .and_then(|state| state.findings.iter().find(|f| f.id == finding_id))
            .cloned()
            .ok_or_else(|| format!("no finding {finding_id} on task {task_id}"))?;
        if matches!(finding.status, Status::Fixed | Status::Dismissed) {
            return Err("that finding is already resolved".into());
        }
        let run_id = finding.run_id.clone();
        let dismissed = wire::KeeperFinding {
            status: Status::Dismissed,
            dismiss_reason: reason
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty()),
            resolved_at: Some(now_secs()),
            ..finding
        };
        self.keepers
            .put_finding(&self.persist, &self.tasks, task_id, dismissed);
        self.keeper_emit_run(task_id, &run_id);
        self.keepers_fix(task_id, None);
        Ok(())
    }

    pub(super) fn keepers_decide(
        &mut self,
        task_id: &str,
        keeper_id: &str,
        decision: KeeperDecision,
        rounds: Option<u32>,
        note: Option<String>,
    ) -> Result<(), String> {
        if !self.tasks.contains_key(task_id) {
            return Err(format!("unknown task {task_id}"));
        }
        let fix = self.keeper_loop(task_id, keeper_id);
        let latest = self.keepers.latest_run(task_id, keeper_id).cloned();
        match decision {
            KeeperDecision::Extend => {
                if fix.stop.is_none() {
                    return Err("the keeper is not waiting for you".into());
                }
                let guidance = note
                    .map(|text| {
                        text.trim()
                            .chars()
                            .take(GUIDANCE_MAX_CHARS)
                            .collect::<String>()
                    })
                    .filter(|text| !text.is_empty());
                let extended = wire::KeeperLoop {
                    stop: None,
                    extra_rounds: fix.extra_rounds + rounds.unwrap_or(1).clamp(1, MAX_ROUNDS_CAP),
                    extended_run: latest.map(|run| run.id),
                    guidance,
                    ..fix
                };
                self.keeper_set_loop(task_id, keeper_id, extended);
            }
            KeeperDecision::Accept => {
                let head = self
                    .keepers
                    .watches
                    .get(task_id)
                    .and_then(|watch| watch.head())
                    .map(str::to_string)
                    .or_else(|| latest.map(|run| run.head_sha));
                let accepted = wire::KeeperLoop {
                    accepted_head: head,
                    pending_head: fix.pending_head,
                    ..Default::default()
                };
                self.keeper_set_loop(task_id, keeper_id, accepted);
            }
            KeeperDecision::Off => return self.keepers_set_switch(task_id, keeper_id, false),
        }
        self.keeper_emit_loop(task_id, keeper_id);
        self.keepers_fix(task_id, None);
        Ok(())
    }

    pub(super) fn keepers_set_switch(
        &mut self,
        task_id: &str,
        keeper_id: &str,
        on: bool,
    ) -> Result<(), String> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("unknown task {task_id}"))?;
        if keeper_id.trim().is_empty() || !task.kind.is_task() {
            return Err("keepers attach to tasks only".into());
        }
        let pending = self.keeper_loop(task_id, keeper_id).pending_head;
        self.keepers_edit_task(task_id, |keepers| {
            keepers.overrides.insert(keeper_id.to_string(), on);
            if !on {
                keepers.loops.remove(keeper_id);
            }
            if let Some(head) = pending.filter(|_| !on) {
                let fix = wire::KeeperLoop {
                    pending_head: Some(head),
                    ..Default::default()
                };
                keepers.loops.insert(keeper_id.to_string(), fix);
            }
        });
        if on {
            self.keepers_poll();
            return Ok(());
        }
        if let Some(keepers) = self.keepers.on.get_mut(task_id) {
            keepers.retain(|definition| definition.id != keeper_id);
        }
        if let Some(ready) = self.keepers.ready.get_mut(task_id) {
            ready
                .keepers
                .retain(|definition| definition.id != keeper_id);
            ready.queued.retain(|definition| definition.id != keeper_id);
        }
        self.keeper_emit_loop(task_id, keeper_id);
        self.keepers_fix(task_id, None);
        Ok(())
    }
}
