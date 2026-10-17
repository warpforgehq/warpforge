//! Smith rows (ADR 0027). The actor's mirror is authoritative; these are
//! loaded once at spawn and written through the persistence queue.

use anyhow::Result;
use rusqlite::{params, Connection, Row};

use warpforge_protocol as wire;

use super::Store;

pub(super) fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS smiths (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            home_project     TEXT NOT NULL,
            allowed_projects TEXT NOT NULL DEFAULT '[]',
            agent            TEXT NOT NULL,
            model            TEXT,
            account_id       TEXT,
            budget           TEXT NOT NULL DEFAULT '{}',
            permissions      TEXT NOT NULL DEFAULT '{}',
            thread_task_id   TEXT NOT NULL,
            soul_rev         TEXT NOT NULL,
            charter_rev      TEXT NOT NULL,
            held             TEXT NOT NULL DEFAULT '[]',
            created_at       INTEGER NOT NULL,
            color            INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS smiths_name_idx ON smiths(name COLLATE NOCASE);
        "#,
    )?;
    // Rows from before colours were stored read NULL and get the id's colour.
    let _ = conn.execute("ALTER TABLE smiths ADD COLUMN color INTEGER", []);
    Ok(())
}

const COLUMNS: &str = "id, name, home_project, allowed_projects, agent, model, account_id, \
     budget, permissions, thread_task_id, soul_rev, charter_rev, held, created_at, color";

fn json<T: serde::de::DeserializeOwned + Default>(text: String) -> T {
    serde_json::from_str(&text).unwrap_or_default()
}

fn smith_from_row(row: &Row<'_>) -> rusqlite::Result<wire::Smith> {
    let id: String = row.get(0)?;
    Ok(wire::Smith {
        id: id.clone(),
        name: row.get(1)?,
        home_project: row.get(2)?,
        allowed_projects: json(row.get(3)?),
        agent: row.get(4)?,
        model: row.get(5)?,
        account_id: row.get(6)?,
        budget: json(row.get(7)?),
        permissions: json(row.get(8)?),
        thread_task_id: row.get(9)?,
        soul_rev: row.get(10)?,
        charter_rev: row.get(11)?,
        held: json(row.get(12)?),
        created_at: row.get::<_, i64>(13)? as u64,
        color: row
            .get::<_, Option<i64>>(14)?
            .and_then(|c| u8::try_from(c).ok())
            .filter(|c| *c < crate::daemon::smiths::PALETTE)
            .unwrap_or_else(|| crate::daemon::smiths::default_color(&id)),
        injection: None,
    })
}

impl Store {
    /// A second Smith with the same name, ignoring case, is an error, never
    /// a replacement.
    pub fn upsert_smith(&self, smith: &wire::Smith) -> Result<()> {
        self.conn.execute(
            &format!(
                "INSERT INTO smiths ({COLUMNS}) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) \
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, \
                 home_project = excluded.home_project, \
                 allowed_projects = excluded.allowed_projects, agent = excluded.agent, \
                 model = excluded.model, account_id = excluded.account_id, \
                 budget = excluded.budget, permissions = excluded.permissions, \
                 thread_task_id = excluded.thread_task_id, soul_rev = excluded.soul_rev, \
                 charter_rev = excluded.charter_rev, held = excluded.held, \
                 color = excluded.color"
            ),
            params![
                smith.id,
                smith.name,
                smith.home_project,
                serde_json::to_string(&smith.allowed_projects)?,
                smith.agent,
                smith.model,
                smith.account_id,
                serde_json::to_string(&smith.budget)?,
                serde_json::to_string(&smith.permissions)?,
                smith.thread_task_id,
                smith.soul_rev,
                smith.charter_rev,
                serde_json::to_string(&smith.held)?,
                smith.created_at as i64,
                smith.color as i64,
            ],
        )?;
        Ok(())
    }

    pub fn delete_smith(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM smiths WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// @returns every Smith, oldest first
    pub fn load_smiths(&self) -> Result<Vec<wire::Smith>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM smiths ORDER BY created_at, id"
        ))?;
        let rows = stmt.query_map([], smith_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Take a deleted Smith off every local backlog item assigned to it.
    /// @param assignee the Smith's `smith:<id>` value
    pub fn clear_backlog_assignee(&self, assignee: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE backlog_items SET assignee = NULL WHERE assignee = ?1 AND source = 'local'",
            params![assignee],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn smith(id: &str, name: &str) -> wire::Smith {
        wire::Smith {
            id: id.into(),
            name: name.into(),
            home_project: "demo".into(),
            allowed_projects: vec!["demo".into(), "other".into()],
            agent: "claude".into(),
            model: Some("opus".into()),
            account_id: None,
            budget: wire::SmithBudget {
                usd_per_day: Some(5.0),
                turns_per_day: None,
            },
            permissions: wire::SmithPermissions {
                write_paths: vec!["src/".into()],
                push: true,
                create_pr: false,
            },
            thread_task_id: format!("t_{id}"),
            soul_rev: "r1".into(),
            charter_rev: "r2".into(),
            held: vec![wire::SmithHold::Paused],
            created_at: 7,
            color: 3,
            injection: None,
        }
    }

    #[test]
    fn smiths_round_trip_and_names_are_unique_ignoring_case() {
        let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
        let ada = smith("sm_1", "Ada");
        store.upsert_smith(&ada).unwrap();
        assert_eq!(store.load_smiths().unwrap(), vec![ada.clone()]);
        assert!(store.upsert_smith(&smith("sm_2", "ada")).is_err());
        assert_eq!(store.load_smiths().unwrap(), vec![ada.clone()]);

        let mut renamed = ada.clone();
        renamed.name = "Grace".into();
        store.upsert_smith(&renamed).unwrap();
        assert_eq!(store.load_smiths().unwrap(), vec![renamed]);
        store.delete_smith("sm_1").unwrap();
        assert!(store.load_smiths().unwrap().is_empty());
    }

    #[test]
    fn a_row_without_a_colour_reads_the_ids_colour() {
        let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
        store.upsert_smith(&smith("sm_1", "Ada")).unwrap();
        store
            .conn
            .execute("UPDATE smiths SET color = NULL", [])
            .unwrap();
        let loaded = store.load_smiths().unwrap();
        assert_eq!(
            loaded[0].color,
            crate::daemon::smiths::default_color("sm_1")
        );
    }
}
