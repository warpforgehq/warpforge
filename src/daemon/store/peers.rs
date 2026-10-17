//! Peer messaging rows (ADR 0026): every message attempt, the digest cursor
//! of each task, and the user's mutes and pauses. The actor's state is
//! authoritative; these are loaded once at spawn and written through the
//! persistence queue.

use anyhow::Result;
use rusqlite::{params, Connection, Row};

use warpforge_protocol as wire;

use super::Store;

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
            alert_cleared_at INTEGER
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
    let _ = conn.execute(
        "ALTER TABLE peer_messages ADD COLUMN alert_cleared_at INTEGER",
        [],
    );
    Ok(())
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
     status, reason, alert, alert_cleared_at";

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
    })
}

impl Store {
    pub fn upsert_peer_message(&self, message: &wire::PeerMessage) -> Result<()> {
        self.conn.execute(
            &format!(
                "INSERT OR REPLACE INTO peer_messages ({MESSAGE_COLUMNS}) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
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
            ],
        )?;
        Ok(())
    }

    /// Feed records, newest first.
    /// @param project only this project's records, when given
    /// @param before only records with a smaller id, when given
    /// @param limit the page size
    /// @returns at most `limit` records
    pub fn load_peer_messages(
        &self,
        project: Option<&str>,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<wire::PeerMessage>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM peer_messages \
             WHERE (?1 IS NULL OR project = ?1) AND (?2 IS NULL OR id < ?2) \
             ORDER BY id DESC LIMIT ?3"
        ))?;
        let rows = stmt.query_map(
            params![project, before.map(|b| b as i64), limit as i64],
            message_from_row,
        )?;
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
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_at(std::path::Path::new(":memory:")).unwrap()
    }

    fn record(id: u64, project: &str, status: wire::PeerMessageStatus) -> wire::PeerMessage {
        wire::PeerMessage {
            id,
            project: project.into(),
            from_task: Some("t_a".into()),
            to_task: Some("t_b".into()),
            text: format!("message {id}"),
            created_at: 100 + id,
            delivered_at: None,
            status,
            reason: None,
            alert: false,
            alert_cleared_at: None,
        }
    }

    #[test]
    fn peer_message_round_trips_and_pages_newest_first() {
        let store = store();
        let mut refused = record(1, "demo", wire::PeerMessageStatus::Refused);
        refused.reason = Some("pair window".into());
        refused.alert = true;
        let mut post = record(2, "demo", wire::PeerMessageStatus::Posted);
        post.to_task = None;
        for message in [
            &refused,
            &post,
            &record(3, "other", wire::PeerMessageStatus::Queued),
        ] {
            store.upsert_peer_message(message).unwrap();
        }

        assert_eq!(
            store.load_peer_messages(Some("demo"), None, 10).unwrap(),
            vec![post.clone(), refused.clone()]
        );
        assert_eq!(
            store.load_peer_messages(None, Some(3), 1).unwrap(),
            vec![post]
        );
        assert_eq!(store.load_peer_messages(None, None, 10).unwrap().len(), 3);
        assert_eq!(store.max_peer_message_id().unwrap(), 3);
    }

    #[test]
    fn rewriting_a_record_updates_its_status() {
        let store = store();
        let mut message = record(1, "demo", wire::PeerMessageStatus::Queued);
        store.upsert_peer_message(&message).unwrap();
        message.status = wire::PeerMessageStatus::Delivered;
        message.delivered_at = Some(200);
        store.upsert_peer_message(&message).unwrap();
        assert_eq!(
            store.load_peer_messages(None, None, 10).unwrap(),
            vec![message]
        );
    }

    #[test]
    fn restart_refuses_only_queued_records() {
        let store = store();
        store
            .upsert_peer_message(&record(1, "demo", wire::PeerMessageStatus::Queued))
            .unwrap();
        store
            .upsert_peer_message(&record(2, "demo", wire::PeerMessageStatus::Delivered))
            .unwrap();
        assert_eq!(store.refuse_queued_peer_messages().unwrap(), 1);
        let loaded = store.load_peer_messages(None, None, 10).unwrap();
        assert_eq!(loaded[0].status, wire::PeerMessageStatus::Delivered);
        assert_eq!(loaded[1].status, wire::PeerMessageStatus::Refused);
        assert_eq!(loaded[1].reason.as_deref(), Some(RESTART_REASON));
    }

    #[test]
    fn cursors_and_controls_round_trip() {
        let store = store();
        assert_eq!(store.max_peer_message_id().unwrap(), 0);
        store.save_peer_cursor("t_a", 4).unwrap();
        store.save_peer_cursor("t_a", 9).unwrap();
        assert_eq!(store.load_peer_cursors().unwrap(), vec![("t_a".into(), 9)]);

        store
            .set_peer_control(PeerControl::Mute, "t_a", true)
            .unwrap();
        store
            .set_peer_control(PeerControl::Mute, "t_a", true)
            .unwrap();
        store
            .set_peer_control(PeerControl::Pause, "demo", true)
            .unwrap();
        assert_eq!(
            store.load_peer_controls(PeerControl::Mute).unwrap(),
            vec!["t_a"]
        );
        assert_eq!(
            store.load_peer_controls(PeerControl::Pause).unwrap(),
            vec!["demo"]
        );
        store
            .set_peer_control(PeerControl::Mute, "t_a", false)
            .unwrap();
        assert!(store
            .load_peer_controls(PeerControl::Mute)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn restart_clears_live_alerts_only() {
        let store = store();
        let mut live = record(1, "demo", wire::PeerMessageStatus::Refused);
        live.alert = true;
        let mut ended = record(2, "demo", wire::PeerMessageStatus::Refused);
        ended.alert = true;
        ended.alert_cleared_at = Some(50);
        for message in [
            &live,
            &ended,
            &record(3, "demo", wire::PeerMessageStatus::Refused),
        ] {
            store.upsert_peer_message(message).unwrap();
        }
        assert_eq!(store.clear_peer_alerts(900).unwrap(), 1);
        let cleared: Vec<_> = store
            .load_peer_messages(None, None, 10)
            .unwrap()
            .into_iter()
            .map(|m| m.alert_cleared_at)
            .collect();
        assert_eq!(cleared, vec![None, Some(50), Some(900)]);
    }
}
