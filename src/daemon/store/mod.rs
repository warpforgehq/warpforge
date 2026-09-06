//! SQLite persistence for the daemon. Tasks are the genuinely new, must-not-be-
//! lost state (projects still live in `~/.warpforge/projects.json`, port ranges
//! are derived from project index), so this store is task-focused for now.
//!
//! The connection is owned by the actor task and only ever touched from there,
//! so no locking is needed beyond what rusqlite provides.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::PathBuf;

mod agents;
mod automations;
mod backlog;
mod schema;
mod sessions;
mod snapshot;
mod tasks;
#[cfg(test)]
mod tests;
mod tracker;

pub use snapshot::fold_for_snapshot;
pub use tracker::TrackerLink;

/// SQL for "the user considers this task closed", mirroring the desktop's
/// `isSettledTask` (`status === "done" || settledOverride === true`).
///
/// Defined once because it was not: settling a task sets `settled_override`
/// and deliberately leaves `status` alone, so every retention query that
/// spelled out `status = 'done'` silently skipped every task the user had
/// actually closed. They stayed invisible in the UI and immortal on disk.
/// `settled_override` is nullable, so it is coalesced rather than compared
/// directly: `NOT (… OR NULL = 1)` is NULL, not true, and would drop exactly
/// the never-settled rows a negated use of this predicate means to keep.
const SETTLED_TASK: &str = "(status = 'done' OR COALESCE(settled_override, 0) = 1)";

/// The timestamp retention windows measure from: when the user closed the
/// task, falling back to its last touch on rows written before `settled_at`
/// existed.
const SETTLED_SINCE: &str = "COALESCE(settled_at, updated_at)";

fn db_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".warpforge")
        .join("warpforge.db")
}

pub struct Store {
    conn: Connection,
}

/// A persisted agent account. Credentials never live here — only the vault path
/// and the display identity read out of it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAccount {
    pub id: String,
    pub agent_id: String,
    pub label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub home_dir: String,
    pub created_at: u64,
    pub active: bool,
}

impl Store {
    /// Open (creating if needed) the default database.
    pub fn open() -> Result<Self> {
        let path = db_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        Self::open_at(&path)
    }

    /// Open at an explicit path (":memory:" works — used by tests).
    pub fn open_at(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        schema::init(&conn)?;
        Ok(Self { conn })
    }

    /// Run `writes` as one transaction. The persistence actor (see
    /// `daemon/runtime/persist.rs`) drains its queue through here so a burst of
    /// streamed session updates costs one commit instead of one per row.
    ///
    /// On any error the whole batch is rolled back — a half-applied batch would
    /// leave a task row without the session updates that explain it.
    pub fn write_batch(&self, writes: impl FnOnce(&Self) -> Result<()>) -> Result<()> {
        self.conn.execute_batch("BEGIN")?;
        match writes(self) {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}
