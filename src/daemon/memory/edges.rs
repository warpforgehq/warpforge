use anyhow::Result;
use rusqlite::params;

use super::helpers::{clamp_relation, content_of};
use super::MemoryStore;
use crate::daemon::memory_types::MemoryError;
use crate::daemon::task::now_secs;

impl MemoryStore {
    // ── v2: graph ──
    pub fn add_edge(
        &self,
        src_id: &str,
        dst_id: &str,
        relation: &str,
    ) -> Result<crate::daemon::memory_types::Edge, MemoryError> {
        let conn = self.guard()?;
        let relation = clamp_relation(relation);
        for id in [src_id, dst_id] {
            if content_of(conn, id)?.is_none() {
                return Err(MemoryError::Other(anyhow::anyhow!(
                    "memory '{id}' not found"
                )));
            }
        }
        let now = now_secs() as i64;
        conn.execute(
            "INSERT OR IGNORE INTO memory_edges (src_id,dst_id,relation,created_at) VALUES (?1,?2,?3,?4)",
            params![src_id, dst_id, relation, now],
        )?;
        Ok(crate::daemon::memory_types::Edge {
            src_id: src_id.into(),
            dst_id: dst_id.into(),
            relation,
            created_at: now,
        })
    }
    pub fn list_edges(
        &self,
        id: &str,
    ) -> Result<Vec<crate::daemon::memory_types::Edge>, MemoryError> {
        let conn = self.guard()?;
        let mut stmt = conn.prepare("SELECT src_id,dst_id,relation,created_at FROM memory_edges WHERE src_id=?1 OR dst_id=?1")?;
        let rows = stmt.query_map(params![id], |r| {
            Ok(crate::daemon::memory_types::Edge {
                src_id: r.get(0)?,
                dst_id: r.get(1)?,
                relation: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
