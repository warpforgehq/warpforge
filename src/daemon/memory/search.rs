use anyhow::Result;
use rusqlite::{params, Connection};

use super::helpers::{load_by_id, row_to_memory, sanitize_query, valid_kind};
use super::MemoryStore;
use crate::daemon::memory_embed::{f32_to_blob, rrf_merge};
use crate::daemon::memory_types::{Memory, MemoryError};
use crate::daemon::task::now_secs;

impl MemoryStore {
    /// Search memories. `mode == "hybrid"` merges FTS (BM25) and vector (cosine)
    /// ranks via RRF when embeddings are enabled, else falls back to pure FTS.
    /// Every returned hit bumps `last_accessed` (feeds future decay).
    /// `scope` `None`/`"all"` searches the global DB *and* every project overlay,
    /// merging the results; a narrow scope searches one DB only.
    pub fn search(
        &self,
        query: &str,
        scope: Option<&str>,
        limit: Option<u32>,
        mode: Option<&str>,
    ) -> Result<Vec<Memory>, MemoryError> {
        // Per-project overlay is primary for project-scoped reads
        if let Some(pid) = scope.and_then(|s| s.strip_prefix("project:")) {
            if let Some(path) = Self::resolve_project_db(Some(pid)) {
                let pconn = Self::open_project_at(&path, self.config.embeddings_enabled())?;
                return self.search_on_conn(&pconn, query, scope, limit, mode);
            }
        }
        let conn = self.guard()?;
        if scope.is_none() || scope == Some("all") {
            self.search_all(conn, query, scope, limit, mode)
        } else {
            self.search_on_conn(conn, query, scope, limit, mode)
        }
    }
    /// Merge global + project results for a non-scoped search.
    fn search_all(
        &self,
        conn: &Connection,
        query: &str,
        scope: Option<&str>,
        limit: Option<u32>,
        mode: Option<&str>,
    ) -> Result<Vec<Memory>, MemoryError> {
        let cap = limit.unwrap_or(10).clamp(1, 100);
        // Fetch with higher recall so overlay results can compete, then re-sort
        // (global first, relevance order preserved within each scope) before
        // truncating to the requested cap.
        let recall = (cap * 2).min(100);
        let mut merged = self.search_on_conn(conn, query, scope, Some(recall), mode)?;
        if self.config.project {
            for path in Self::project_dbs() {
                if !path.exists() {
                    continue;
                }
                let pconn = Self::open_project_at(&path, self.config.embeddings_enabled())?;
                let proj =
                    self.search_on_conn(&pconn, query, Some("project"), Some(recall), mode)?;
                for m in proj {
                    if !merged.iter().any(|x| x.id == m.id) {
                        merged.push(m);
                    }
                }
            }
        }
        merged.sort_by_key(|b| std::cmp::Reverse(b.scope == "global"));
        merged.truncate(cap as usize);
        Ok(merged)
    }
    fn search_on_conn(
        &self,
        conn: &Connection,
        query: &str,
        scope: Option<&str>,
        limit: Option<u32>,
        mode: Option<&str>,
    ) -> Result<Vec<Memory>, MemoryError> {
        let sanitized = sanitize_query(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.unwrap_or(10).clamp(1, 100) as i64;
        let predicate = self.scope_predicate(scope)?;
        let hybrid = matches!(mode, Some("hybrid")) && self.embed.lock().unwrap().is_enabled();
        if hybrid {
            self.hybrid_search(conn, &sanitized, &predicate, limit)
        } else {
            self.fts_search(conn, &sanitized, &predicate, limit)
        }
    }
    /// Pure FTS5 BM25 search with snippets (v1 behavior, unchanged).
    fn fts_search(
        &self,
        conn: &Connection,
        sanitized: &str,
        predicate: &str,
        limit: i64,
    ) -> Result<Vec<Memory>, MemoryError> {
        let results = self.fts_search_inner(conn, sanitized, predicate, limit)?;
        if !results.is_empty() || !sanitized.contains(' ') {
            return Ok(results);
        }
        // Ranked-OR fallback: strict AND returned 0 → retry with OR so partial matches surface (bug #2)
        let or_query = sanitized
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" OR ");
        let or_results = self.fts_search_inner(conn, &or_query, predicate, limit)?;
        Ok(or_results)
    }
    fn fts_search_inner(
        &self,
        conn: &Connection,
        sanitized: &str,
        predicate: &str,
        limit: i64,
    ) -> Result<Vec<Memory>, MemoryError> {
        let where_sql = if predicate.is_empty() {
            "memories_fts MATCH ?1".to_string()
        } else {
            format!("memories_fts MATCH ?1 AND {predicate}")
        };
        let sql = format!(
            "SELECT m.id, m.project_id, m.scope, m.kind, m.content, m.created_at, \
                    m.updated_at, m.last_accessed, m.created_by, m.superseded_by, m.tags, \
                    snippet(memories_fts, 1, '<b>', '</b>', '...', 12) \
             FROM memories m JOIN memories_fts ON memories_fts.id = m.id \
             WHERE {where_sql} \
             ORDER BY (m.scope = 'global') ASC, rank LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![sanitized, limit], |row| {
            let snippet: Option<String> = row.get(11)?;
            row_to_memory(row, snippet)
        })?;
        let mut results = Vec::new();
        for row in rows {
            let mut mem = row?;
            let now = now_secs() as i64;
            conn.execute(
                "UPDATE memories SET last_accessed = ?1 WHERE id = ?2",
                params![now, mem.id],
            )?;
            mem.last_accessed = now;
            results.push(mem);
        }
        Ok(results)
    }
    /// Hybrid = FTS BM25 ranks + vector cosine ranks fused by RRF.
    fn hybrid_search(
        &self,
        conn: &Connection,
        sanitized: &str,
        predicate: &str,
        limit: i64,
    ) -> Result<Vec<Memory>, MemoryError> {
        let recall = (limit * 3).clamp(30, 500);
        let fts_ids = self.fts_ranked_ids(conn, sanitized, predicate, recall)?;
        let Some(vec_ids) = self.vec_ranked_ids(conn, sanitized, predicate, recall)? else {
            return self.fts_search(conn, sanitized, predicate, limit);
        };
        let merged = rrf_merge(&fts_ids, &vec_ids, limit as usize);
        self.load_ranked(conn, &merged)
    }
    fn fts_ranked_ids(
        &self,
        conn: &Connection,
        sanitized: &str,
        predicate: &str,
        recall: i64,
    ) -> Result<Vec<String>, MemoryError> {
        let where_sql = if predicate.is_empty() {
            "memories_fts MATCH ?1".to_string()
        } else {
            format!("memories_fts MATCH ?1 AND {predicate}")
        };
        let sql = format!(
            "SELECT m.id FROM memories m JOIN memories_fts ON memories_fts.id = m.id \
             WHERE {where_sql} ORDER BY rank LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![sanitized, recall], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(ids)
    }
    /// `None` when embeddings are disabled or the model is unavailable.
    fn vec_ranked_ids(
        &self,
        conn: &Connection,
        sanitized: &str,
        predicate: &str,
        recall: i64,
    ) -> Result<Option<Vec<String>>, MemoryError> {
        let query_vec = {
            let mut engine = self.embed.lock().unwrap();
            if !engine.is_enabled() {
                return Ok(None);
            }
            match engine.embed(&[sanitized]) {
                Some(embeddings) => embeddings.into_iter().next(),
                None => return Ok(None),
            }
        };
        let Some(query_vec) = query_vec else {
            return Ok(None);
        };
        let blob = f32_to_blob(&query_vec);
        let join_where = if predicate.is_empty() {
            String::new()
        } else {
            format!("AND {predicate}")
        };
        let sql = format!(
            "WITH knn AS (\
               SELECT rowid AS r, distance FROM memories_vec \
               WHERE embedding MATCH ?1 AND k = ?2) \
             SELECT m.id FROM knn JOIN memories m ON m.rowid = knn.r \
             WHERE 1 = 1 {join_where} ORDER BY knn.distance LIMIT ?3"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![blob, recall, recall], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(Some(ids))
    }
    fn load_ranked(&self, conn: &Connection, ids: &[String]) -> Result<Vec<Memory>, MemoryError> {
        let mut results = Vec::new();
        for id in ids {
            if let Ok(mut mem) = load_by_id(conn, id) {
                let now = now_secs() as i64;
                conn.execute(
                    "UPDATE memories SET last_accessed = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
                mem.last_accessed = now;
                results.push(mem);
            }
        }
        Ok(results)
    }
    pub fn list(
        &self,
        scope: Option<&str>,
        kind: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<Memory>, MemoryError> {
        if let Some(pid) = scope.and_then(|s| s.strip_prefix("project:")) {
            if let Some(path) = Self::resolve_project_db(Some(pid)) {
                let pconn = Self::open_project_at(&path, self.config.embeddings_enabled())?;
                return Self::list_on_conn(&pconn, self, scope, kind, limit, offset);
            }
        }
        let conn = self.guard()?;
        if scope.is_none() || scope == Some("all") {
            self.list_all(conn, scope, kind, limit, offset)
        } else {
            Self::list_on_conn(conn, self, scope, kind, limit, offset)
        }
    }
    /// Merge global + project rows for a non-scoped list.
    fn list_all(
        &self,
        conn: &Connection,
        scope: Option<&str>,
        kind: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<Memory>, MemoryError> {
        let mut merged = Self::list_on_conn(conn, self, scope, kind, None, None)?;
        if self.config.project {
            for path in Self::project_dbs() {
                if !path.exists() {
                    continue;
                }
                let pconn = Self::open_project_at(&path, self.config.embeddings_enabled())?;
                let proj = Self::list_on_conn(&pconn, self, Some("project"), kind, None, None)?;
                for m in proj {
                    if !merged.iter().any(|x| x.id == m.id) {
                        merged.push(m);
                    }
                }
            }
        }
        merged.sort_by(|a, b| {
            (b.scope == "global")
                .cmp(&(a.scope == "global"))
                .then(b.updated_at.cmp(&a.updated_at))
        });
        let offset = offset.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).clamp(1, 1000) as usize;
        Ok(merged.into_iter().skip(offset).take(limit).collect())
    }
    fn list_on_conn(
        conn: &Connection,
        store: &Self,
        scope: Option<&str>,
        kind: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<Memory>, MemoryError> {
        let mut conditions = Vec::new();
        let predicate = store.scope_predicate(scope)?;
        if !predicate.is_empty() {
            conditions.push(predicate);
        }
        if let Some(k) = kind.and_then(valid_kind) {
            conditions.push(format!("m.kind = '{k}'"));
        }
        let where_sql = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let limit = limit.unwrap_or(100).clamp(1, 1000) as i64;
        let offset = offset.unwrap_or(0) as i64;
        let sql = format!(
            "SELECT id, project_id, scope, kind, content, created_at, updated_at, \
                    last_accessed, created_by, superseded_by, tags \
             FROM memories m {where_sql} \
             ORDER BY (m.scope = 'global') ASC, m.updated_at DESC LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit, offset], |row| row_to_memory(row, None))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }
}
