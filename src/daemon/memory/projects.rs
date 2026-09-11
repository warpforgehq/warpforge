use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;
use rusqlite::Connection;

use super::helpers::{
    clean_vec_orphans, collect_project_dbs, migrate_fts_tags, sanitize_project_id,
};
use super::MemoryStore;
use super::{seed_meta, SCHEMA};
use crate::daemon::memory_embed::{ensure_vec_extension, vec_table_sql};

impl MemoryStore {
    pub(super) fn any_project_db_exists() -> bool {
        let base = dirs::home_dir()
            .map(|h| h.join(".warpforge/projects"))
            .unwrap_or_default();
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                if e.path().join(".warpforge/memory.db").exists() {
                    return true;
                }
            }
        }
        false
    }
    /// Per-project overlay path. Returns Some(path) if file exists.
    /// Sanitizes: rejects empty, `.`, `..`, `/`, `\`, and any char outside
    /// `[a-zA-Z0-9_-]`.
    pub fn resolve_project_db(project_id: Option<&str>) -> Option<PathBuf> {
        let pid = project_id?;
        if !sanitize_project_id(pid) {
            return None;
        }
        // Check env override and home heuristic
        for base in [
            std::env::var("WARP_PROJECTS_DIR").ok().map(PathBuf::from),
            dirs::home_dir().map(|h| h.join(".warpforge/projects").join(pid)),
        ]
        .into_iter()
        .flatten()
        {
            let p = base.join(".warpforge/memory.db");
            // base already includes pid for home case; for env var, pid subdir
            let candidate = if base.ends_with(pid) {
                p
            } else {
                base.join(pid).join(".warpforge/memory.db")
            };
            if candidate.exists() {
                return Some(candidate);
            }
        }
        // Also check pid as direct path (tests)
        let direct = PathBuf::from(pid).join(".warpforge/memory.db");
        if direct.exists() {
            return Some(direct);
        }
        None
    }
    pub fn per_project_db_exists_for(&self, project_id: Option<&str>) -> bool {
        Self::resolve_project_db(project_id).is_some()
    }
    pub(super) fn project_db_path(pid: &str) -> Option<PathBuf> {
        if !sanitize_project_id(pid) {
            return None;
        }
        if let Ok(base) = std::env::var("WARP_PROJECTS_DIR") {
            return Some(PathBuf::from(base).join(pid).join(".warpforge/memory.db"));
        }
        Some(
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".warpforge/projects")
                .join(pid)
                .join(".warpforge/memory.db"),
        )
    }
    /// All existing project overlay DB paths (both `WARP_PROJECTS_DIR` and the
    /// home heuristic), for merging non-scoped reads.
    pub(super) fn project_dbs() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(base) = std::env::var("WARP_PROJECTS_DIR") {
            collect_project_dbs(&PathBuf::from(base), &mut out);
        }
        if let Some(home) = dirs::home_dir() {
            collect_project_dbs(&home.join(".warpforge/projects"), &mut out);
        }
        let mut seen = HashSet::new();
        out.retain(|p| seen.insert(p.clone()));
        out
    }
    pub(super) fn open_project_at(path: &Path, embeddings: bool) -> Result<Connection> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        ensure_vec_extension();
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.execute_batch(SCHEMA)?;
        migrate_fts_tags(&conn)?;
        clean_vec_orphans(&conn);
        seed_meta(&conn)?;
        if embeddings {
            conn.execute_batch(&vec_table_sql())?;
        }
        Ok(conn)
    }
}
