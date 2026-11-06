//! Keeper runs and findings (ADR 0030). The actor's mirror is authoritative;
//! these are loaded once at spawn and written through the persistence queue.

use std::collections::HashMap;

use anyhow::Result;
use rusqlite::{params, Connection, Row};
use serde::{de::DeserializeOwned, Serialize};

use warpforge_protocol as wire;

use super::Store;
use crate::daemon::keepers::KeeperState;

pub(super) fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS keeper_runs (
            id              TEXT PRIMARY KEY,
            task_id         TEXT NOT NULL,
            keeper_id       TEXT NOT NULL,
            run_number      INTEGER NOT NULL,
            trigger         TEXT NOT NULL,
            head_sha        TEXT NOT NULL,
            base_sha        TEXT,
            started_at      INTEGER NOT NULL,
            finished_at     INTEGER,
            outcome         TEXT,
            count           INTEGER NOT NULL DEFAULT 0,
            checker_task_id TEXT,
            round           INTEGER NOT NULL DEFAULT 0,
            cost            TEXT,
            error           TEXT,
            draft           TEXT
        );
        CREATE INDEX IF NOT EXISTS keeper_runs_task_idx
            ON keeper_runs(task_id, keeper_id, run_number);
        CREATE TABLE IF NOT EXISTS keeper_findings (
            id             TEXT PRIMARY KEY,
            run_id         TEXT NOT NULL,
            key            TEXT NOT NULL,
            severity       TEXT NOT NULL,
            file           TEXT,
            line           INTEGER,
            description    TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'open',
            dismiss_reason TEXT,
            resolved_at    INTEGER
        );
        CREATE INDEX IF NOT EXISTS keeper_findings_run_idx ON keeper_findings(run_id);
        "#,
    )?;
    // Migration: a `result: draft` run's text.
    let _ = conn.execute("ALTER TABLE keeper_runs ADD COLUMN draft TEXT", []);
    Ok(())
}

/// A queued keeper row write.
pub enum KeeperWrite {
    Run(Box<wire::KeeperRun>),
    Finding(Box<wire::KeeperFinding>),
}

fn word<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(word)) => word,
        _ => String::new(),
    }
}

fn from_word<T: DeserializeOwned + Default>(word: String) -> T {
    serde_json::from_value(serde_json::Value::String(word)).unwrap_or_default()
}

const RUN_COLUMNS: &str = "id, task_id, keeper_id, run_number, trigger, head_sha, base_sha, \
     started_at, finished_at, outcome, count, checker_task_id, round, cost, error, draft";

const FINDING_COLUMNS: &str =
    "id, run_id, key, severity, file, line, description, status, dismiss_reason, resolved_at";

fn run_from_row(row: &Row<'_>) -> rusqlite::Result<wire::KeeperRun> {
    Ok(wire::KeeperRun {
        id: row.get(0)?,
        task_id: row.get(1)?,
        keeper_id: row.get(2)?,
        run_number: row.get::<_, i64>(3)? as u64,
        trigger: from_word(row.get(4)?),
        head_sha: row.get(5)?,
        base_sha: row.get(6)?,
        started_at: row.get::<_, i64>(7)? as u64,
        finished_at: row.get::<_, Option<i64>>(8)?.map(|at| at as u64),
        outcome: row
            .get::<_, Option<String>>(9)?
            .and_then(|word| serde_json::from_value(serde_json::Value::String(word)).ok()),
        count: row.get::<_, i64>(10)? as u32,
        checker_task_id: row.get(11)?,
        round: row.get::<_, i64>(12)? as u32,
        cost: row
            .get::<_, Option<String>>(13)?
            .and_then(|json| serde_json::from_str(&json).ok()),
        error: row.get(14)?,
        draft: row.get(15)?,
    })
}

fn finding_from_row(row: &Row<'_>) -> rusqlite::Result<wire::KeeperFinding> {
    Ok(wire::KeeperFinding {
        id: row.get(0)?,
        run_id: row.get(1)?,
        key: row.get(2)?,
        severity: from_word(row.get(3)?),
        file: row.get(4)?,
        line: row.get::<_, Option<i64>>(5)?.map(|line| line as u32),
        description: row.get(6)?,
        status: from_word(row.get(7)?),
        dismiss_reason: row.get(8)?,
        resolved_at: row.get::<_, Option<i64>>(9)?.map(|at| at as u64),
    })
}

impl Store {
    /// @param write the row to insert or replace
    pub fn apply_keeper_write(&self, write: &KeeperWrite) -> Result<()> {
        match write {
            KeeperWrite::Run(run) => self.conn.execute(
                &format!(
                    "INSERT OR REPLACE INTO keeper_runs ({RUN_COLUMNS}) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"
                ),
                params![
                    run.id,
                    run.task_id,
                    run.keeper_id,
                    run.run_number as i64,
                    word(&run.trigger),
                    run.head_sha,
                    run.base_sha,
                    run.started_at as i64,
                    run.finished_at.map(|at| at as i64),
                    run.outcome.as_ref().map(word),
                    run.count,
                    run.checker_task_id,
                    run.round,
                    run.cost.as_ref().map(serde_json::to_string).transpose()?,
                    run.error,
                    run.draft,
                ],
            )?,
            KeeperWrite::Finding(finding) => self.conn.execute(
                &format!(
                    "INSERT OR REPLACE INTO keeper_findings ({FINDING_COLUMNS}) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
                ),
                params![
                    finding.id,
                    finding.run_id,
                    finding.key,
                    word(&finding.severity),
                    finding.file,
                    finding.line,
                    finding.description,
                    word(&finding.status),
                    finding.dismiss_reason,
                    finding.resolved_at.map(|at| at as i64),
                ],
            )?,
        };
        Ok(())
    }

    /// Every task's keeper rows; a finding whose run is gone is dropped.
    /// @returns task id → its runs (by keeper, then run number) and findings
    pub fn load_keeper_state(&self) -> Result<HashMap<String, KeeperState>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM keeper_runs ORDER BY task_id, keeper_id, run_number"
        ))?;
        let runs = stmt
            .query_map([], run_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut task_of: HashMap<String, String> = HashMap::new();
        let mut out: HashMap<String, KeeperState> = HashMap::new();
        for run in runs {
            task_of.insert(run.id.clone(), run.task_id.clone());
            out.entry(run.task_id.clone()).or_default().runs.push(run);
        }
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {FINDING_COLUMNS} FROM keeper_findings ORDER BY rowid"
        ))?;
        for finding in stmt.query_map([], finding_from_row)? {
            let finding = finding?;
            if let Some(state) = task_of.get(&finding.run_id).and_then(|t| out.get_mut(t)) {
                state.findings.push(finding);
            }
        }
        Ok(out)
    }

    /// Part of [`Store::delete_task`].
    pub(super) fn delete_keeper_rows(&self, task_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM keeper_findings \
             WHERE run_id IN (SELECT id FROM keeper_runs WHERE task_id = ?1)",
            params![task_id],
        )?;
        self.conn.execute(
            "DELETE FROM keeper_runs WHERE task_id = ?1",
            params![task_id],
        )?;
        Ok(())
    }
}
