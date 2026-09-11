use std::path::{Path, PathBuf};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

use crate::daemon::memory_types::{Memory, MemoryError};

// ── Helpers ──

const KINDS: &[&str] = &["fact", "decision", "preference", "gotcha", "note"];
const RELATIONS: &[&str] = &["related", "supports", "contradicts", "supersedes"];
pub(super) fn clamp_relation(r: &str) -> String {
    let lower = r.trim().to_lowercase();
    if RELATIONS.contains(&lower.as_str()) {
        lower
    } else {
        "related".into()
    }
}
// TODO(cross-encoder): benchmark cross-encoder reranker (e.g. MiniLM cross-encoder) on recall tasks before enabling; see spec §11.

pub(super) fn valid_kind(kind: &str) -> Option<&str> {
    KINDS.iter().copied().find(|k| *k == kind)
}

pub(super) fn clamp_kind(kind: Option<&str>) -> String {
    kind.and_then(valid_kind).unwrap_or("note").to_string()
}

/// Strip FTS5 query metacharacters so arbitrary user text cannot throw a MATCH
/// syntax error. An empty result after sanitization means "no query".
pub(super) fn sanitize_query(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    for ch in query.chars() {
        match ch {
            '"' | '*' | ':' | '(' | ')' | '^' | '&' | '|' | '-' => out.push(' '),
            c => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Strict project-id validator used wherever a project id becomes a filesystem
/// path. Rejects empty, `.`, `..`, `/`, `\`, and anything outside
/// `[a-zA-Z0-9_-]`.
pub(super) fn sanitize_project_id(pid: &str) -> bool {
    !pid.is_empty()
        && pid != "."
        && pid != ".."
        && pid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(super) fn clean_vec_orphans(conn: &Connection) {
    // Remove vec rows whose memories rowid no longer exists (orphans left by
    // pre-txn bug where vec rowid was taken from FTS). Best-effort, ignore errors if vec0 missing.
    let _ = conn.execute(
        "DELETE FROM memories_vec WHERE rowid NOT IN (SELECT rowid FROM memories)",
        [],
    );
}

/// Auto-migrate old FTS table (without `tags` column) to new schema.
/// No user action needed: detects legacy `memories_fts`, rebuilds with `tags` and backfills from `memories.tags`.
pub(super) fn migrate_fts_tags(conn: &Connection) -> Result<()> {
    let sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='memories_fts'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let Some(create_sql) = sql else { return Ok(()) };
    if create_sql.contains("tags") {
        return Ok(());
    }
    // Legacy FTS without tags: rebuild
    conn.execute_batch(
        "DROP TABLE IF EXISTS memories_fts;
         CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content, tags, tokenize='porter');",
    )?;
    // Backfill from memories (tags JSON -> space-joined)
    let mut stmt = conn.prepare("SELECT id, content, tags FROM memories")?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, content, tags_json) in rows {
        let tags_fts = serde_json::from_str::<Vec<String>>(&tags_json)
            .unwrap_or_default()
            .join(" ");
        conn.execute(
            "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
            params![id, content, tags_fts],
        )?;
    }
    Ok(())
}

/// Collect `<root>/<pid>/.warpforge/memory.db` for every existing project DB.
pub(super) fn collect_project_dbs(root: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let db = e.path().join(".warpforge/memory.db");
            if db.exists() {
                out.push(db);
            }
        }
    }
}

pub(super) fn content_of(conn: &Connection, id: &str) -> Result<Option<String>, MemoryError> {
    Ok(conn
        .query_row(
            "SELECT content FROM memories WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?)
}

pub(super) fn load_by_id(conn: &Connection, id: &str) -> Result<Memory, MemoryError> {
    Ok(conn.query_row(
        "SELECT id, project_id, scope, kind, content, created_at, updated_at, \
                last_accessed, created_by, superseded_by, tags \
         FROM memories WHERE id = ?1",
        params![id],
        |row| row_to_memory(row, None),
    )?)
}

pub(super) fn row_to_memory(
    row: &rusqlite::Row<'_>,
    snippet: Option<String>,
) -> rusqlite::Result<Memory> {
    let tags_json: String = row.get(10)?;
    Ok(Memory {
        id: row.get(0)?,
        project_id: row.get(1)?,
        scope: row.get(2)?,
        kind: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        last_accessed: row.get(7)?,
        created_by: row.get(8)?,
        superseded_by: row.get(9)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        snippet,
    })
}
