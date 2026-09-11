//! Shared memory: durable cross-session facts/decisions/preferences searchable
//! by every harness (Claude, Codex, opencode). FTS5 in v1, optional local
//! embeddings (v1.5) — no dreaming execution. The store owns its own connection
//! to `~/.warpforge/memory.db`, isolated from the main warpforge DB, and is only
//! touched from the daemon actor thread (same single-threaded-access rationale
//! as `store.rs`).
//!
//! `memories_fts` is a regular FTS5 table (not external-content) because FTS5
//! requires an integer rowid while `memories.id` is a TEXT uuid: the uuid is
//! kept as an `UNINDEXED` column and rows are kept in sync with plain
//! INSERT/DELETE statements keyed on that id.
//!
//! When `memory.embedding == "fastembed"`, a `memories_vec` (`vec0`) table holds
//! cosine embeddings keyed by the memories table's implicit rowid, kept in sync
//! on store/update/delete. Search mode `hybrid` merges FTS BM25 and vector
//! cosine ranks via reciprocal-rank fusion; the embedding model lives in
//! [`super::memory_embed`] and degrades to FTS-only when unavailable.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use super::memory_config::MemoryConfig;
use super::memory_embed::{ensure_vec_extension, EmbedEngine};
use super::memory_types::{Memory, ScopesEnabled, Stats};
use super::task::now_secs;

pub use super::memory_types::MemoryError;

mod dream;
mod edges;
mod embeddings;
mod helpers;
mod projects;
mod search;
mod store;

#[cfg(test)]
mod tests;

use helpers::{clean_vec_orphans, content_of, load_by_id, migrate_fts_tags};

// ── Store ──

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    project_id     TEXT,
    scope          TEXT NOT NULL,
    kind           TEXT NOT NULL,
    content        TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    last_accessed  INTEGER NOT NULL,
    created_by     TEXT,
    superseded_by  TEXT,
    tags           TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    id UNINDEXED, content, tags, tokenize='porter');
CREATE TABLE IF NOT EXISTS memory_compaction_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_type  TEXT,
    target_ids     TEXT,
    reason         TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','applied','rejected')),
    created_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS memory_edges (
    src_id TEXT NOT NULL,
    dst_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (src_id, dst_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_memory_edges_src ON memory_edges(src_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_dst ON memory_edges(dst_id);
"#;

pub struct MemoryStore {
    conn: Option<Connection>,
    config: MemoryConfig,
    disabled: Option<String>,
    /// Embedding engine, lazily loaded. Guarded by a mutex so the model's
    /// `&mut self` embed fits the store's `&self` methods and the struct stays
    /// `Send`; only ever touched from the actor thread.
    embed: Mutex<EmbedEngine>,
}

fn seed_meta(conn: &Connection) -> Result<()> {
    for (key, value) in [
        ("embedding_model", "none"),
        ("dims", "0"),
        ("schema_version", "1"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }
    Ok(())
}
impl MemoryStore {
    fn default_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".warpforge")
            .join("memory.db")
    }

    /// Open (creating if needed) the default memory database.
    pub fn open() -> Result<Self> {
        let path = Self::default_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        Self::open_at(&path)
    }

    /// Open at an explicit path (":memory:" works — used by tests).
    pub fn open_at(path: &Path) -> Result<Self> {
        ensure_vec_extension();
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.execute_batch(SCHEMA)?;
        migrate_fts_tags(&conn)?;
        clean_vec_orphans(&conn);
        seed_meta(&conn)?;
        Ok(Self {
            conn: Some(conn),
            config: MemoryConfig::default(),
            disabled: None,
            embed: Mutex::new(EmbedEngine::new(false)),
        })
    }

    /// Load config and open the store. Never fails: a disabled or unopenable
    /// store is represented as a `disabled` flag so the daemon stays up and the
    /// memory tools report "memory disabled" instead of crashing.
    pub fn load() -> Self {
        let config = MemoryConfig::load();
        if !config.enabled {
            return Self {
                conn: None,
                config,
                disabled: Some("memory disabled".into()),
                embed: Mutex::new(EmbedEngine::new(false)),
            };
        }
        match Self::open() {
            Ok(mut store) => {
                store.config = config;
                if store.config.embeddings_enabled() && store.apply_embedding_config().is_err() {
                    store.config.embedding = "none".into();
                    *store.embed.lock().unwrap() = EmbedEngine::new(false);
                }
                store
            }
            Err(e) => Self {
                conn: None,
                config,
                disabled: Some(format!("memory disabled: {e}")),
                embed: Mutex::new(EmbedEngine::new(false)),
            },
        }
    }
    pub fn enabled(&self) -> bool {
        self.config.enabled && self.disabled.is_none() && self.conn.is_some()
    }
    fn guard(&self) -> Result<&Connection, MemoryError> {
        if let Some(reason) = &self.disabled {
            return Err(MemoryError::Disabled(reason.clone()));
        }
        self.conn
            .as_ref()
            .ok_or_else(|| MemoryError::Disabled("memory disabled".into()))
    }
    pub fn update(&self, id: &str, content: &str) -> Result<Memory, MemoryError> {
        let conn = self.guard()?;
        let existing = content_of(conn, id)?;
        if existing.is_none() {
            return Err(MemoryError::Other(anyhow::anyhow!(
                "memory '{id}' not found"
            )));
        }
        let now = now_secs() as i64;
        conn.execute(
            "UPDATE memories SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![content, now, id],
        )?;
        conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id])?;
        // preserve tags in FTS on content update
        let tags_json: String = conn.query_row(
            "SELECT tags FROM memories WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        let tags_fts: String = serde_json::from_str::<Vec<String>>(&tags_json)
            .unwrap_or_default()
            .join(" ");
        conn.execute(
            "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
            params![id, content, tags_fts],
        )?;
        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM memories WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        if self.embeddings_active() {
            conn.execute("DELETE FROM memories_vec WHERE rowid = ?1", params![rowid])?;
        }
        self.index_embedding(conn, rowid, content)?;
        load_by_id(conn, id)
    }
    pub fn delete(&self, id: &str) -> Result<(), MemoryError> {
        let conn = self.guard()?;
        let existing = content_of(conn, id)?;
        if existing.is_none() {
            return Err(MemoryError::Other(anyhow::anyhow!(
                "memory '{id}' not found"
            )));
        }
        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM memories WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id])?;
        conn.execute(
            "DELETE FROM memory_edges WHERE src_id = ?1 OR dst_id = ?1",
            params![id],
        )?;
        if self.embeddings_active() {
            conn.execute("DELETE FROM memories_vec WHERE rowid = ?1", params![rowid])?;
        }
        Ok(())
    }
    pub fn stats(&self) -> Result<Stats, MemoryError> {
        let conn = self.guard()?;
        let global_count = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE scope = 'global'",
            [],
            |row| row.get(0),
        )?;
        let project_count = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE scope LIKE 'project:%'",
            [],
            |row| row.get(0),
        )?;
        let (embedding_mode, embedding_unavailable) = {
            let engine = self.embed.lock().unwrap();
            if engine.is_enabled() && engine.unavailable_reason().is_none() {
                ("hybrid", None)
            } else {
                ("fts", engine.unavailable_reason().map(|s| s.to_string()))
            }
        };
        Ok(Stats {
            global_count,
            project_count,
            embedding_mode: embedding_mode.into(),
            scopes_enabled: ScopesEnabled {
                global: self.config.global,
                project: self.config.project,
            },
            per_project_db_exists: Self::any_project_db_exists(),
            embedding_unavailable,
        })
    }
    pub fn config(&self) -> &super::memory_config::MemoryConfig {
        &self.config
    }
}
