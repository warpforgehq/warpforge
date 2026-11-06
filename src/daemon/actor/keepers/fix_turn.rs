//! A fix turn's end: a finished turn closes its round; a cut-short turn, an
//! undelivered prompt or a restart gives its findings back (invariant 5).

use warpforge_protocol as wire;
use wire::KeeperFindingStatus as Status;

use super::{Fix, FixPhase};
use crate::daemon::actor::Daemon;

impl Daemon {
    /// @param completed the turn ended on its own, not interrupted or failed
    pub(super) fn keepers_fix_ended(&mut self, task_id: &str, completed: bool) {
        if !completed {
            self.keepers_fix_revert(task_id, None);
            return;
        }
        let sent = self
            .keepers
            .fixes
            .get(task_id)
            .is_some_and(|fix| matches!(fix.phase, FixPhase::Sent { .. }));
        let Some(fix) = sent.then(|| self.keepers.fixes.remove(task_id)).flatten() else {
            return;
        };
        for keeper_id in &fix.keepers {
            let mut done = self.keeper_loop(task_id, keeper_id);
            done.pending_head = None;
            self.keeper_set_loop(task_id, keeper_id, done);
            self.keeper_emit_loop(task_id, keeper_id);
        }
    }

    /// Undo a hand-over: its findings are `open` again and each keeper's
    /// loop is as it was, so the round does not count.
    /// @param waiting why the fix now waits, when it should not retry at once
    pub(super) fn keepers_fix_revert(&mut self, task_id: &str, waiting: Option<String>) {
        let sent = self
            .keepers
            .fixes
            .get(task_id)
            .is_some_and(|fix| matches!(fix.phase, FixPhase::Sent { .. }));
        let Some(fix) = sent.then(|| self.keepers.fixes.remove(task_id)).flatten() else {
            return;
        };
        let FixPhase::Sent { findings, prior } = fix.phase else {
            return;
        };
        self.keepers_reopen(task_id, |finding| findings.contains(&finding.id));
        for (keeper_id, before) in prior {
            self.keeper_set_loop(task_id, &keeper_id, before);
        }
        if let Some(reason) = waiting {
            let held = Fix {
                head: fix.head,
                keepers: fix.keepers.clone(),
                phase: FixPhase::Waiting(reason),
            };
            self.keepers.fixes.insert(task_id.to_string(), held);
        }
        for keeper_id in &fix.keepers {
            self.keeper_emit_loop(task_id, keeper_id);
        }
    }

    /// A round handed over before a restart never ended here: its findings
    /// are sent again without counting it twice.
    pub(super) fn keepers_fix_orphans(&mut self, task_id: &str) {
        if self.keepers.fixes.contains_key(task_id) {
            return;
        }
        let pending: Vec<(String, String)> = self
            .tasks
            .get(task_id)
            .and_then(|task| task.keepers.as_ref())
            .map(|keepers| {
                keepers
                    .loops
                    .iter()
                    .filter_map(|(id, fix)| Some((id.clone(), fix.pending_head.clone()?)))
                    .collect()
            })
            .unwrap_or_default();
        for (keeper_id, head) in pending {
            let runs: Vec<String> = self
                .keepers
                .task(task_id)
                .map(|state| {
                    let at_head = state
                        .runs
                        .iter()
                        .filter(|run| run.keeper_id == keeper_id && run.head_sha == head);
                    at_head.map(|run| run.id.clone()).collect()
                })
                .unwrap_or_default();
            self.keepers_reopen(task_id, |finding| runs.contains(&finding.run_id));
            let mut fix = self.keeper_loop(task_id, &keeper_id);
            fix.pending_head = None;
            self.keeper_set_loop(task_id, &keeper_id, fix);
        }
    }

    fn keepers_reopen(&mut self, task_id: &str, which: impl Fn(&wire::KeeperFinding) -> bool) {
        let reopened: Vec<wire::KeeperFinding> = self
            .keepers
            .task(task_id)
            .map(|state| {
                let sent = state.findings.iter().filter(|f| f.status == Status::Sent);
                sent.filter(|f| which(f)).cloned().collect()
            })
            .unwrap_or_default();
        for finding in reopened {
            let finding = wire::KeeperFinding {
                status: Status::Open,
                ..finding
            };
            self.keepers
                .put_finding(&self.persist, &self.tasks, task_id, finding);
        }
    }
}
