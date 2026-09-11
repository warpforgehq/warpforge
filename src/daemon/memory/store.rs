use std::sync::Mutex;

use anyhow::Result;
use rusqlite::{params, Connection};

use super::helpers::{clamp_kind, load_by_id};
use super::MemoryStore;
use crate::daemon::memory_embed::{f32_to_blob, EmbedEngine};
use crate::daemon::memory_types::{Memory, MemoryError};
use crate::daemon::task::now_secs;

impl MemoryStore {
    fn resolve_write_scope(
        &self,
        scope: Option<&str>,
        project_id: Option<&str>,
    ) -> Result<String, MemoryError> {
        if let Some(s) = scope {
            if s == "global" {
                if !self.config.global {
                    return Err(MemoryError::Scope("global memory is disabled".into()));
                }
                return Ok("global".into());
            }
            if s.starts_with("session") {
                return Err(MemoryError::Scope(
                    "session-scoped memory is not supported in v1".into(),
                ));
            }
        }
        if let Some(pid) = project_id {
            if !self.config.project {
                return Err(MemoryError::Scope(
                    "project-scoped memory is disabled; enable memory.project".into(),
                ));
            }
            return Ok(format!("project:{pid}"));
        }
        if !self.config.global {
            return Err(MemoryError::Scope("global memory is disabled".into()));
        }
        Ok("global".into())
    }
    /// SQL condition (`m.`-prefixed) narrowing a read to the enabled scope(s).
    /// `None`/`"all"` narrow to the union of enabled scopes (empty = no filter);
    /// an explicit `"global"`/`"project"` whose scope is disabled is an error
    /// rather than silently coercing to the other scope.
    pub(super) fn scope_predicate(&self, scope: Option<&str>) -> Result<String, MemoryError> {
        let (want_global, want_project) = match scope {
            Some("global") => (true, false),
            Some("project") => (false, true),
            _ => (true, true),
        };
        if want_global && !want_project && !self.config.global {
            return Err(MemoryError::Scope("global memory is disabled".into()));
        }
        if want_project && !want_global && !self.config.project {
            return Err(MemoryError::Scope("project memory is disabled".into()));
        }
        let g = want_global && self.config.global;
        let p = want_project && self.config.project;
        Ok(match (g, p) {
            (true, true) => String::new(),
            (true, false) => "m.scope = 'global'".into(),
            (false, true) => "m.scope LIKE 'project:%'".into(),
            (false, false) => "0".into(),
        })
    }
    #[allow(clippy::too_many_arguments)]
    pub fn store(
        &self,
        content: &str,
        scope: Option<&str>,
        kind: Option<&str>,
        tags: Option<&[String]>,
        project_id: Option<&str>,
        created_by: Option<&str>,
    ) -> Result<Memory, MemoryError> {
        let project_id = project_id
            .filter(|p| !p.trim().is_empty())
            .map(str::to_string);
        let scope = self.resolve_write_scope(scope, project_id.as_deref())?;
        if let Some(pid) = scope.strip_prefix("project:").map(|s| s.to_string()) {
            let should_overlay = Self::resolve_project_db(Some(&pid)).is_some()
                || self.config.per_project.unwrap_or(false);
            if should_overlay {
                let Some(path) = Self::project_db_path(&pid) else {
                    return Err(MemoryError::Scope("invalid project id".into()));
                };
                let pconn = Self::open_project_at(&path, self.config.embeddings_enabled())?;
                return Self::store_on_conn(
                    &pconn,
                    &self.embed,
                    project_id,
                    scope,
                    content,
                    kind,
                    tags,
                    created_by,
                );
            }
        }
        let conn = self.guard()?;
        let kind = clamp_kind(kind);
        let tags = tags.unwrap_or(&[]).to_vec();
        let tags_json = serde_json::to_string(&tags)?;
        let tags_fts = tags.join(" ");
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_secs() as i64;
        // Transaction ensures vec UNIQUE failure doesn't leave orphan memories row (bug #1)
        // and we capture rowid BEFORE FTS insert (last_insert_rowid would otherwise point to FTS).
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let res: Result<Memory, MemoryError> = (|| {
            conn.execute(
                "INSERT INTO memories \
                 (id, project_id, scope, kind, content, created_at, updated_at, \
                  last_accessed, created_by, superseded_by, tags) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    id,
                    project_id,
                    scope,
                    kind,
                    content,
                    now,
                    now,
                    now,
                    created_by,
                    None::<String>,
                    tags_json
                ],
            )?;
            let rowid = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
                params![id, content, tags_fts],
            )?;
            self.index_embedding(conn, rowid, content)?;
            load_by_id(conn, &id)
        })();
        match res {
            Ok(m) => {
                conn.execute_batch("COMMIT")?;
                Ok(m)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn store_on_conn(
        conn: &Connection,
        embed: &Mutex<EmbedEngine>,
        project_id: Option<String>,
        scope: String,
        content: &str,
        kind: Option<&str>,
        tags: Option<&[String]>,
        created_by: Option<&str>,
    ) -> Result<Memory, MemoryError> {
        let kind = clamp_kind(kind);
        let tags = tags.unwrap_or(&[]).to_vec();
        let tags_json = serde_json::to_string(&tags)?;
        let tags_fts = tags.join(" ");
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_secs() as i64;
        conn.execute(
            "INSERT INTO memories (id,project_id,scope,kind,content,created_at,updated_at,last_accessed,created_by,superseded_by,tags) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![id, project_id, scope, kind, content, now, now, now, created_by, None::<String>, tags_json],
        )?;
        let rowid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
            params![id, content, tags_fts],
        )?;
        // inline embedding index
        {
            let mut eng = embed.lock().unwrap();
            if eng.is_enabled() {
                if let Some(vec) = eng.embed(&[content]).and_then(|mut v| v.pop()) {
                    let blob = f32_to_blob(&vec);
                    conn.execute(
                        "INSERT OR REPLACE INTO memories_vec (rowid, embedding) VALUES (?1, ?2)",
                        params![rowid, blob],
                    )?;
                }
            }
        }
        load_by_id(conn, &id)
    }
}
