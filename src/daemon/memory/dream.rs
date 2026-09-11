use anyhow::Result;
use rusqlite::params;

use super::MemoryStore;
use crate::daemon::memory_types::MemoryError;
use crate::daemon::task::now_secs;

impl MemoryStore {
    pub fn pending_compaction_count(&self) -> u64 {
        let Ok(conn) = self.guard() else { return 0 };
        conn.query_row(
            "SELECT COUNT(*) FROM memory_compaction_log WHERE status='pending'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }
    pub fn resolve_compaction(&self, id: i64, approve: bool) -> Result<String, MemoryError> {
        let conn = self.guard()?;
        let status = if approve { "applied" } else { "rejected" };
        let changed = conn.execute(
            "UPDATE memory_compaction_log SET status=?1 WHERE id=?2 AND status='pending'",
            params![status, id],
        )?;
        if changed == 0 {
            return Err(MemoryError::Other(anyhow::anyhow!(
                "not found or not pending"
            )));
        }
        Ok(status.to_string())
    }
    pub fn resolve_compaction_for_targets(
        &self,
        target_ids: &str,
        approve: bool,
    ) -> Result<usize, MemoryError> {
        let conn = self.guard()?;
        let status = if approve { "approved" } else { "rejected" };
        let mut count = 0;
        for tid in target_ids
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            count += conn.execute(
                "UPDATE memory_compaction_log SET status=?1 WHERE target_ids LIKE ?2 AND status='pending'",
                params![status, format!("%{}%", tid)],
            )?;
        }
        Ok(count)
    }
    pub fn list_compaction_log(&self) -> Result<Vec<serde_json::Value>, MemoryError> {
        let conn = self.guard()?;
        let mut stmt = conn.prepare(
            "SELECT id, proposal_type, target_ids, reason, status, created_at FROM memory_compaction_log ORDER BY created_at DESC LIMIT 100",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "proposal_type": r.get::<_, Option<String>>(1)?,
                "target_ids": r.get::<_, Option<String>>(2)?,
                "reason": r.get::<_, Option<String>>(3)?,
                "status": r.get::<_, String>(4)?,
                "created_at": r.get::<_, i64>(5)?,
            }))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
    pub fn dream_with_config(
        &self,
        dry_run: bool,
        cfg: &crate::daemon::memory_config::DreamingConfig,
        fallback_model: Option<&str>,
    ) -> Result<serde_json::Value, MemoryError> {
        let model = cfg.effective_model(fallback_model);
        // Agent dreaming would spawn an LLM run here via `generate_text` with the
        // chosen `model`/`agent`; this sync store path has no agent runtime, so we
        // log the intent and fall back to the heuristic pass. The resolved model is
        // surfaced in the result so callers can drive the agent path.
        if let Some(m) = &model {
            eprintln!(
                "[memory] dreaming agent path requested (agent={} model={m}); falling back to heuristic",
                cfg.agent
            );
        }
        let mut out = self.dream(dry_run)?;
        if let Some(obj) = out.as_object_mut() {
            obj.insert(
                "model".into(),
                model.map_or(serde_json::Value::Null, serde_json::Value::String),
            );
        }
        Ok(out)
    }
    /// Dream pass: tries agent flow then falls back to heuristic.
    /// Agent path uses dream_prompt over 200 oldest last_accessed; heuristic provides proposals when no agent.
    pub fn dream(&self, dry_run: bool) -> Result<serde_json::Value, MemoryError> {
        self.guard()?;
        let pending_before = self.pending_compaction_count();
        // Try agent-parsed proposals if prompt yields rows; insert via validated path
        let prompt = self.dream_prompt();
        let has_memories = !prompt.is_empty();
        let mut inserted = 0usize;
        if has_memories && !dry_run {
            // Attempt to use any pending agent proposals would come via inserted heuristic below;
            // agent JSON path is exercised via dream_with_proposals when caller has LLM text.
            inserted = self.propose_compaction()?;
        } else if has_memories && dry_run {
            // dry_run: count what would be inserted (deduped) without writing
            let conn = self.guard()?;
            let mut dup = 0usize;
            let mut stmt = conn.prepare(
                "SELECT (SELECT GROUP_CONCAT(id, ',') FROM (SELECT id FROM memories m2 WHERE m2.content = m.content ORDER BY id)) FROM memories m GROUP BY content HAVING COUNT(*)>1",
            )?;
            let dup_rows: Vec<String> = stmt
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for ids in &dup_rows {
                let exists: i64 = conn.query_row("SELECT COUNT(*) FROM memory_compaction_log WHERE proposal_type='duplicate' AND target_ids=?1 AND status='pending'", params![ids], |r| r.get(0))?;
                if exists == 0 {
                    dup += 1;
                }
            }
            let now = now_secs() as i64;
            let stale_cutoff = now - 30 * 24 * 3600;
            let mut stmt2 = conn.prepare("SELECT id FROM memories WHERE last_accessed < ?1 AND updated_at < ?1 ORDER BY last_accessed ASC LIMIT 200")?;
            let stale_ids: Vec<String> = stmt2
                .query_map(params![stale_cutoff], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stale = 0;
            for id in &stale_ids {
                let exists: i64 = conn.query_row("SELECT COUNT(*) FROM memory_compaction_log WHERE proposal_type='stale' AND target_ids=?1 AND status='pending'", params![id.clone()], |r| r.get(0))?;
                if exists == 0 {
                    stale += 1;
                }
            }
            inserted = dup + stale;
        } else if !has_memories {
            inserted = 0;
        }
        if !dry_run && !has_memories {
            // no memories: nothing to insert
        }
        let proposals = self.list_compaction_log()?;
        Ok(
            serde_json::json!({"proposals": proposals, "dry_run": dry_run, "inserted": inserted, "pending": self.pending_compaction_count(), "pending_before": pending_before, "prompt": prompt.chars().take(200).collect::<String>()}),
        )
    }
    /// Insert validated proposals parsed from agent JSON (decay-ordered 200). Deduplicates pending and validates target_ids.
    pub fn dream_with_proposals(
        &self,
        text: &str,
        dry_run: bool,
    ) -> Result<serde_json::Value, MemoryError> {
        let proposals = crate::daemon::memory_dream::parse_proposals(text);
        if dry_run {
            let valid: Vec<_> = proposals
                .iter()
                .filter(|(_, ids, _)| self.validate_target_ids(ids))
                .collect();
            return Ok(
                serde_json::json!({"proposals": valid.len(), "dry_run": true, "parsed": proposals.len()}),
            );
        }
        let conn = self.guard()?;
        let now = now_secs() as i64;
        let mut inserted = 0;
        for (ptype, target_ids, reason) in proposals {
            if !self.validate_target_ids(&target_ids) {
                continue;
            }
            let exists: i64 = conn.query_row("SELECT COUNT(*) FROM memory_compaction_log WHERE proposal_type=?1 AND target_ids=?2 AND status='pending'", params![ptype, target_ids], |r| r.get(0))?;
            if exists > 0 {
                continue;
            }
            conn.execute("INSERT INTO memory_compaction_log (proposal_type,target_ids,reason,status,created_at) VALUES (?1,?2,?3,'pending',?4)", params![ptype, target_ids, reason, now])?;
            inserted += 1;
        }
        Ok(serde_json::json!({"inserted": inserted, "pending": self.pending_compaction_count()}))
    }
    fn validate_target_ids(&self, ids: &str) -> bool {
        let Ok(conn) = self.guard() else {
            return false;
        };
        for id in ids.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM memories WHERE id=?1",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if exists == 0 {
                return false;
            }
        }
        true
    }
    pub fn dream_prompt(&self) -> String {
        let Ok(conn) = self.guard() else {
            return String::new();
        };
        let mut stmt = match conn.prepare(
            "SELECT id, content, last_accessed FROM memories ORDER BY last_accessed ASC LIMIT 200",
        ) {
            Ok(s) => s,
            Err(_) => return String::new(),
        };
        let rows: Vec<(String, String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap_or_default();
        if rows.is_empty() {
            return String::new();
        }
        crate::daemon::memory_dream::dream_prompt(&rows)
    }
    /// Heuristic compaction: find duplicates (same content) and stale (old + low access), log pending proposals.
    /// Idempotent: skips if identical pending proposal already exists.
    pub fn propose_compaction(&self) -> Result<usize, MemoryError> {
        let conn = self.guard()?;
        let now = now_secs() as i64;
        let stale_cutoff = now - 30 * 24 * 3600;
        let mut count = 0;
        let mut stmt = conn.prepare(
            "SELECT (SELECT GROUP_CONCAT(id, ',') FROM (SELECT id FROM memories m2 WHERE lower(trim(m2.content)) = lower(trim(m.content)) ORDER BY id)) FROM memories m GROUP BY lower(trim(content)) HAVING COUNT(*)>1",
        )?;
        let dup_rows: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for ids in dup_rows {
            let exists: i64 = conn.query_row("SELECT COUNT(*) FROM memory_compaction_log WHERE proposal_type='duplicate' AND target_ids=?1 AND status='pending'", params![ids], |r| r.get(0))?;
            if exists == 0 {
                conn.execute("INSERT INTO memory_compaction_log (proposal_type,target_ids,reason,status,created_at) VALUES ('duplicate',?1,'duplicate content','pending',?2)", params![ids, now])?;
                count += 1;
            }
        }
        // stale: one proposal per stale id to keep granularity
        let mut stmt2 =
            conn.prepare("SELECT id FROM memories WHERE last_accessed < ?1 AND updated_at < ?1")?;
        let stale_ids: Vec<String> = stmt2
            .query_map(params![stale_cutoff], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in stale_ids {
            let exists: i64 = conn.query_row("SELECT COUNT(*) FROM memory_compaction_log WHERE proposal_type='stale' AND target_ids=?1 AND status='pending'", params![id.clone()], |r| r.get(0))?;
            if exists == 0 {
                conn.execute("INSERT INTO memory_compaction_log (proposal_type,target_ids,reason,status,created_at) VALUES ('stale',?1,'stale 30d','pending',?2)", params![id, now])?;
                count += 1;
            }
        }
        Ok(count)
    }
}
