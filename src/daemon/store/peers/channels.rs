//! Named channels and their Smith members (ADR 0026 addendum). The actor's
//! mirror is authoritative; these are loaded at spawn and written through the
//! persistence queue.

use anyhow::Result;
use rusqlite::{params, Connection};

use super::super::Store;

pub(super) fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS channels (
            id         TEXT PRIMARY KEY,
            project    TEXT NOT NULL,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS channels_name_idx ON channels(project, name);
        CREATE TABLE IF NOT EXISTS channel_members (
            channel_id TEXT NOT NULL,
            smith_id   TEXT NOT NULL,
            PRIMARY KEY (channel_id, smith_id)
        );
        "#,
    )?;
    Ok(())
}

/// A channel as stored: its members by Smith id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredChannel {
    pub id: String,
    pub project: String,
    pub name: String,
    pub created_at: u64,
    pub members: Vec<String>,
}

impl Store {
    /// Write a channel and replace its member list.
    pub fn upsert_channel(&self, channel: &StoredChannel) -> Result<()> {
        self.conn.execute(
            "INSERT INTO channels (id, project, name, created_at) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![
                channel.id,
                channel.project,
                channel.name,
                channel.created_at as i64
            ],
        )?;
        self.conn.execute(
            "DELETE FROM channel_members WHERE channel_id = ?1",
            params![channel.id],
        )?;
        for smith in &channel.members {
            self.conn.execute(
                "INSERT INTO channel_members (channel_id, smith_id) VALUES (?1, ?2)",
                params![channel.id, smith],
            )?;
        }
        Ok(())
    }

    pub fn delete_channel(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM channel_members WHERE channel_id = ?1",
            params![id],
        )?;
        self.conn
            .execute("DELETE FROM channels WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// @returns every channel with its members, oldest first
    pub fn load_channels(&self) -> Result<Vec<StoredChannel>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project, name, created_at FROM channels ORDER BY created_at, id",
        )?;
        let mut channels: Vec<StoredChannel> = stmt
            .query_map([], |row| {
                Ok(StoredChannel {
                    id: row.get(0)?,
                    project: row.get(1)?,
                    name: row.get(2)?,
                    created_at: row.get::<_, i64>(3)? as u64,
                    members: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut members = self
            .conn
            .prepare("SELECT channel_id, smith_id FROM channel_members ORDER BY smith_id")?;
        let rows = members.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (channel_id, smith_id) = row?;
            if let Some(channel) = channels.iter_mut().find(|c| c.id == channel_id) {
                channel.members.push(smith_id);
            }
        }
        Ok(channels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_round_trip_with_their_members_and_unique_names() {
        let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
        let mut ci = StoredChannel {
            id: "ch_1".into(),
            project: "demo".into(),
            name: "ci".into(),
            created_at: 5,
            members: vec!["sm_1".into(), "sm_2".into()],
        };
        store.upsert_channel(&ci).unwrap();
        assert_eq!(store.load_channels().unwrap(), vec![ci.clone()]);
        let twin = StoredChannel {
            id: "ch_2".into(),
            members: Vec::new(),
            ..ci.clone()
        };
        assert!(store.upsert_channel(&twin).is_err(), "one #ci per project");
        ci.name = "builds".into();
        ci.members = vec!["sm_2".into()];
        store.upsert_channel(&ci).unwrap();
        assert_eq!(store.load_channels().unwrap(), vec![ci]);
        store.delete_channel("ch_1").unwrap();
        assert!(store.load_channels().unwrap().is_empty());
    }
}
