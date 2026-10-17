//! A Smith's daily budget (ADR 0027): turns started and USD spent by its
//! tasks in the last 24 hours, counted in memory. `start_work` is refused past
//! either limit; the hard pause and the meter view are P2.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
pub(crate) struct Spend {
    /// When each of a Smith's turns started.
    turns: HashMap<String, VecDeque<Instant>>,
    /// Each rise in a Smith task's running cost, and when.
    usd: HashMap<String, VecDeque<(Instant, f64)>>,
    /// The last running cost each task reported.
    last_cost: HashMap<String, f64>,
}

impl Spend {
    fn expire(&mut self, now: Instant) {
        for turns in self.turns.values_mut() {
            while turns
                .front()
                .is_some_and(|at| now.duration_since(*at) >= DAY)
            {
                turns.pop_front();
            }
        }
        for costs in self.usd.values_mut() {
            while costs
                .front()
                .is_some_and(|(at, _)| now.duration_since(*at) >= DAY)
            {
                costs.pop_front();
            }
        }
    }

    /// @param smith_id the Smith
    /// @param now the current instant
    /// @returns its turns and USD over the last day
    pub(crate) fn today(&mut self, smith_id: &str, now: Instant) -> (u32, f64) {
        self.expire(now);
        let turns = self.turns.get(smith_id).map_or(0, VecDeque::len) as u32;
        let usd = self
            .usd
            .get(smith_id)
            .map_or(0.0, |costs| costs.iter().map(|(_, usd)| usd).sum());
        (turns, usd)
    }

    pub(crate) fn note_turn(&mut self, smith_id: &str, now: Instant) {
        self.turns
            .entry(smith_id.to_string())
            .or_default()
            .push_back(now);
    }

    /// Count the rise in a task's running cost against its Smith.
    pub(crate) fn note_cost(&mut self, smith_id: &str, task_id: &str, running: f64, now: Instant) {
        let before = self
            .last_cost
            .insert(task_id.to_string(), running)
            .unwrap_or(0.0);
        if running > before {
            self.usd
                .entry(smith_id.to_string())
                .or_default()
                .push_back((now, running - before));
        }
    }
}

/// Why `budget` refuses more work after `turns` turns and `usd` spent today.
/// @returns the refusal, past either limit
pub(crate) fn over_budget(budget: &wire::SmithBudget, turns: u32, usd: f64) -> Option<String> {
    if budget.turns_per_day.is_some_and(|limit| turns >= limit) {
        return Some(format!("its {turns} turns today reach the daily limit"));
    }
    if budget.usd_per_day.is_some_and(|limit| usd >= limit) {
        return Some(format!("its ${usd:.2} today reaches the daily limit"));
    }
    None
}

impl Daemon {
    /// A turn started in a Smith's task.
    pub(crate) fn smith_note_turn(&mut self, task_id: &str) {
        if let Some(smith_id) = self.task_smith_id(task_id) {
            self.smiths.spend.note_turn(&smith_id, Instant::now());
        }
    }

    /// A Smith's task reported its running cost.
    pub(crate) fn smith_note_cost(&mut self, task_id: &str, cost: Option<&wire::SessionUsageCost>) {
        let Some(cost) = cost.filter(|cost| cost.currency == "USD") else {
            return;
        };
        if let Some(smith_id) = self.task_smith_id(task_id) {
            self.smiths
                .spend
                .note_cost(&smith_id, task_id, cost.amount, Instant::now());
        }
    }

    /// Why the Smith's budget refuses more work today.
    pub(crate) fn smith_budget_refusal(&mut self, smith: &wire::Smith) -> Option<String> {
        let (turns, usd) = self.smiths.spend.today(&smith.id, Instant::now());
        over_budget(&smith.budget, turns, usd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spend_counts_a_day_of_turns_and_cost_rises() {
        let mut spend = Spend::default();
        let start = Instant::now();
        spend.note_turn("sm", start);
        spend.note_turn("sm", start);
        spend.note_cost("sm", "t1", 0.5, start);
        spend.note_cost("sm", "t1", 1.25, start);
        spend.note_cost("sm", "t1", 1.0, start);
        assert_eq!(spend.today("sm", start), (2, 1.25));
        assert_eq!(spend.today("sm", start + DAY), (0, 0.0));
    }

    #[test]
    fn either_limit_refuses() {
        let budget = wire::SmithBudget {
            usd_per_day: Some(2.0),
            turns_per_day: Some(10),
        };
        assert!(over_budget(&budget, 9, 1.9).is_none());
        assert!(over_budget(&budget, 10, 0.0).is_some());
        assert!(over_budget(&budget, 0, 2.0).is_some());
        assert!(over_budget(&wire::SmithBudget::default(), 999, 999.0).is_none());
    }
}
