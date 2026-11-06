use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

use warpforge_protocol as wire;
use wire::KeeperFindingStatus as Status;

use super::PRECISION_WINDOW;

/// One task's keeper runs and findings, as the actor mirrors them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KeeperState {
    pub runs: Vec<wire::KeeperRun>,
    pub findings: Vec<wire::KeeperFinding>,
}

impl KeeperState {
    /// @param run inserted, or replacing the run with its id
    pub fn put_run(&mut self, run: wire::KeeperRun) {
        match self.runs.iter_mut().find(|r| r.id == run.id) {
            Some(slot) => *slot = run,
            None => self.runs.push(run),
        }
    }

    /// @param finding inserted, or replacing the finding with its id
    pub fn put_finding(&mut self, finding: wire::KeeperFinding) {
        match self.findings.iter_mut().find(|f| f.id == finding.id) {
            Some(slot) => *slot = finding,
            None => self.findings.push(finding),
        }
    }
}

/// Precision per keeper id over the newest resolved findings.
/// @param states the keeper state of every task in one project
/// @returns one entry per keeper with at least one resolved finding
pub fn precision<'a>(
    states: impl IntoIterator<Item = &'a KeeperState>,
) -> Vec<wire::KeeperPrecision> {
    let mut resolved: BTreeMap<&str, Vec<&wire::KeeperFinding>> = BTreeMap::new();
    for state in states {
        let keeper_of: HashMap<&str, &str> = state
            .runs
            .iter()
            .map(|run| (run.id.as_str(), run.keeper_id.as_str()))
            .collect();
        for finding in &state.findings {
            if !matches!(finding.status, Status::Fixed | Status::Dismissed) {
                continue;
            }
            if let Some(keeper_id) = keeper_of.get(finding.run_id.as_str()) {
                resolved.entry(keeper_id).or_default().push(finding);
            }
        }
    }
    resolved
        .into_iter()
        .map(|(keeper_id, mut findings)| {
            findings.sort_by_key(|f| Reverse(f.resolved_at.unwrap_or(0)));
            findings.truncate(PRECISION_WINDOW);
            let fixed = findings
                .iter()
                .filter(|f| f.status == Status::Fixed)
                .count() as u32;
            wire::KeeperPrecision {
                keeper_id: keeper_id.to_string(),
                fixed,
                dismissed: findings.len() as u32 - fixed,
            }
        })
        .collect()
}
