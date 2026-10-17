//! Peer messaging rows (ADR 0026): every message attempt, the digest cursor
//! of each task, and the user's mutes and pauses. The actor's state is
//! authoritative; these are loaded once at spawn and written through the
//! persistence queue.

use anyhow::Result;
use rusqlite::{params, Connection, Row};

use warpforge_protocol as wire;

mod channels;

pub use channels::StoredChannel;

use super::Store;

/// The feed filter value that names `#general`, the records with no channel.
pub const GENERAL_CHANNEL: &str = "general";

/// Why a record that was still queued when the daemon stopped was refused.
pub const RESTART_REASON: &str = "daemon restarted";

pub(super) fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS peer_messages (
            id           INTEGER PRIMARY KEY,
            project      TEXT NOT NULL,
            from_task    TEXT,
            to_task      TEXT,
            text         TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            delivered_at INTEGER,
            status       TEXT NOT NULL,
            reason       TEXT,
            alert        INTEGER NOT NULL DEFAULT 0,
            alert_cleared_at INTEGER,
            mentions     TEXT,
            source_id    INTEGER,
            started_task TEXT,
            channel_id   TEXT
        );
        CREATE INDEX IF NOT EXISTS peer_messages_project_idx ON peer_messages(project, id);
        CREATE TABLE IF NOT EXISTS peer_cursors (
            task_id   TEXT PRIMARY KEY,
            last_seen INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS peer_controls (
            kind TEXT NOT NULL,
            key  TEXT NOT NULL,
            PRIMARY KEY (kind, key)
        );
        "#,
    )?;
    for column in [
        "alert_cleared_at INTEGER",
        "mentions TEXT",
        "source_id INTEGER",
        "started_task TEXT",
        "channel_id TEXT",
    ] {
        let _ = conn.execute(
            &format!("ALTER TABLE peer_messages ADD COLUMN {column}"),
            [],
        );
    }
    channels::init(conn)
}

/// A persisted hold on peer messaging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerControl {
    /// Keyed by task id.
    Mute,
    /// Keyed by project name.
    Pause,
}

impl PeerControl {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mute => "mute",
            Self::Pause => "pause",
        }
    }
}

const MESSAGE_COLUMNS: &str = "id, project, from_task, to_task, text, created_at, delivered_at, \
     status, reason, alert, alert_cleared_at, mentions, source_id, started_task, channel_id";

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<wire::PeerMessage> {
    Ok(wire::PeerMessage {
        id: row.get::<_, i64>(0)? as u64,
        project: row.get(1)?,
        from_task: row.get(2)?,
        to_task: row.get(3)?,
        text: row.get(4)?,
        created_at: row.get::<_, i64>(5)? as u64,
        delivered_at: row.get::<_, Option<i64>>(6)?.map(|t| t as u64),
        status: wire::PeerMessageStatus::parse(&row.get::<_, String>(7)?),
        reason: row.get(8)?,
        alert: row.get::<_, i64>(9)? != 0,
        alert_cleared_at: row.get::<_, Option<i64>>(10)?.map(|t| t as u64),
        mentions: row
            .get::<_, Option<String>>(11)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default(),
        source_id: row.get::<_, Option<i64>>(12)?.map(|id| id as u64),
        started_task: row.get(13)?,
        channel_id: row.get(14)?,
    })
}

impl Store {
    pub fn upsert_peer_message(&self, message: &wire::PeerMessage) -> Result<()> {
        self.conn.execute(
            &format!(
                "INSERT OR REPLACE INTO peer_messages ({MESSAGE_COLUMNS}) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
            ),
            params![
                message.id as i64,
                message.project,
                message.from_task,
                message.to_task,
                message.text,
                message.created_at as i64,
                message.delivered_at.map(|t| t as i64),
                message.status.as_str(),
                message.reason,
                message.alert as i64,
                message.alert_cleared_at.map(|t| t as i64),
                (!message.mentions.is_empty())
                    .then(|| serde_json::to_string(&message.mentions).unwrap_or_default()),
                message.source_id.map(|id| id as i64),
                message.started_task,
                message.channel_id,
            ],
        )?;
        Ok(())
    }

    /// Feed records, newest first.
    /// @param project only this project's records, when given
    /// @param before only records with a smaller id, when given
    /// @param limit the page size
    /// @param channel only one channel's records: an id, or
    /// [`GENERAL_CHANNEL`] for the records with none
    /// @returns at most `limit` records
    pub fn load_peer_messages(
        &self,
        project: Option<&str>,
        before: Option<u64>,
        limit: u32,
        channel: Option<&str>,
    ) -> Result<Vec<wire::PeerMessage>> {
        let general = channel == Some(GENERAL_CHANNEL);
        let named = channel.filter(|c| *c != GENERAL_CHANNEL);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM peer_messages \
             WHERE (?1 IS NULL OR project = ?1) AND (?2 IS NULL OR id < ?2) \
             AND (?4 = 0 OR channel_id IS NULL) AND (?5 IS NULL OR channel_id = ?5) \
             ORDER BY id DESC LIMIT ?3"
        ))?;
        let rows = stmt.query_map(
            params![
                project,
                before.map(|b| b as i64),
                limit as i64,
                general,
                named
            ],
            message_from_row,
        )?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// @param status which records
    /// @returns every record with that status, oldest first
    pub fn load_peer_messages_with_status(
        &self,
        status: wire::PeerMessageStatus,
    ) -> Result<Vec<wire::PeerMessage>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM peer_messages WHERE status = ?1 ORDER BY id"
        ))?;
        let rows = stmt.query_map(params![status.as_str()], message_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// The newest channel posts of every project, for the digests.
    /// @param per_project how many to keep per project and channel
    /// @returns oldest first within each project and channel
    pub fn load_recent_peer_posts(&self, per_project: u32) -> Result<Vec<wire::PeerMessage>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM ( \
                 SELECT *, ROW_NUMBER() OVER (PARTITION BY project, channel_id ORDER BY id DESC) AS n \
                 FROM peer_messages WHERE status = 'posted' AND started_task IS NULL \
             ) WHERE n <= ?1 ORDER BY id"
        ))?;
        let rows = stmt.query_map(params![per_project as i64], message_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// The largest record id, so the actor numbers new records after it.
    /// @returns 0 for an empty table
    pub fn max_peer_message_id(&self) -> Result<u64> {
        let id: Option<i64> =
            self.conn
                .query_row("SELECT MAX(id) FROM peer_messages", [], |row| row.get(0))?;
        Ok(id.unwrap_or(0) as u64)
    }

    /// Refuse every record still queued: session queues do not survive a
    /// restart, so nothing is waiting to deliver them.
    /// @returns how many records were refused
    pub fn refuse_queued_peer_messages(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "UPDATE peer_messages SET status = 'refused', reason = ?1 WHERE status = 'queued'",
            params![RESTART_REASON],
        )?)
    }

    /// End every alert still live: the guard's windows do not survive a
    /// restart.
    /// @param now unix seconds
    /// @returns how many alerts were cleared
    pub fn clear_peer_alerts(&self, now: u64) -> Result<usize> {
        Ok(self.conn.execute(
            "UPDATE peer_messages SET alert_cleared_at = ?1 \
             WHERE alert = 1 AND alert_cleared_at IS NULL",
            params![now as i64],
        )?)
    }

    /// Drop a deleted task's cursor and mute; its records stay in the feed.
    /// @param task_id the deleted task
    pub fn forget_peer_task(&self, task_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM peer_cursors WHERE task_id = ?1",
            params![task_id],
        )?;
        self.conn.execute(
            "DELETE FROM peer_controls WHERE kind = ?1 AND key = ?2",
            params![PeerControl::Mute.as_str(), task_id],
        )?;
        Ok(())
    }

    pub fn save_peer_cursor(&self, task_id: &str, last_seen: u64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO peer_cursors (task_id, last_seen) VALUES (?1, ?2)",
            params![task_id, last_seen as i64],
        )?;
        Ok(())
    }

    /// @returns `(task id, last channel post id it has seen)` per task
    pub fn load_peer_cursors(&self) -> Result<Vec<(String, u64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT task_id, last_seen FROM peer_cursors")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Turn a mute or pause on or off.
    /// @param kind which hold
    /// @param key the task id for a mute, the project for a pause
    /// @param on whether the hold applies
    pub fn set_peer_control(&self, kind: PeerControl, key: &str, on: bool) -> Result<()> {
        if on {
            self.conn.execute(
                "INSERT OR IGNORE INTO peer_controls (kind, key) VALUES (?1, ?2)",
                params![kind.as_str(), key],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM peer_controls WHERE kind = ?1 AND key = ?2",
                params![kind.as_str(), key],
            )?;
        }
        Ok(())
    }

    /// @param kind which hold
    /// @returns every key the hold applies to
    pub fn load_peer_controls(&self, kind: PeerControl) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key FROM peer_controls WHERE kind = ?1 ORDER BY key")?;
        let rows = stmt.query_map(params![kind.as_str()], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

#[cfg(test)]
mod tests;
