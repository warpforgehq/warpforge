use anyhow::Result;
use rusqlite::{params, Connection};

use crate::daemon::memory_config::save_embedding;
use crate::daemon::memory_embed::{ensure_vec_extension, f32_to_blob, vec_table_sql, EmbedEngine};
use crate::daemon::memory_types::{MemoryError, Stats};

use super::MemoryStore;

impl MemoryStore {
    /// Create the vec table and flip the engine to match `config.embedding`.
    pub(super) fn apply_embedding_config(&self) -> Result<(), MemoryError> {
        let enabled = self.config.embeddings_enabled();
        *self.embed.lock().unwrap() = EmbedEngine::new(enabled);
        if enabled {
            ensure_vec_extension();
            self.guard()?.execute_batch(&vec_table_sql())?;
        }
        self.write_embedding_meta(enabled)
    }
    fn write_embedding_meta(&self, enabled: bool) -> Result<(), MemoryError> {
        let conn = self.guard()?;
        let (model, dims): (&str, String) = if enabled {
            (
                "fastembed",
                crate::daemon::memory_embed::EMBED_DIMS.to_string(),
            )
        } else {
            ("none", "0".into())
        };
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('embedding_model', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![model],
        )?;
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('dims', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![dims],
        )?;
        Ok(())
    }
    /// Change the embedding mode at runtime (Settings → Memory). `none` clears
    /// vectors; `fastembed` creates the vec table and backfills existing
    /// memories. Persists to config.yaml best-effort.
    pub fn set_embedding(&mut self, mode: &str) -> Result<Stats, MemoryError> {
        let mode = match mode {
            "none" | "fastembed" => mode,
            other => {
                return Err(MemoryError::Other(anyhow::anyhow!(
                    "invalid embedding mode '{other}' (want 'none' or 'fastembed')"
                )))
            }
        };
        self.config.embedding = mode.to_string();
        let _ = save_embedding(mode);
        // apply_embedding_config and backfill may panic when ort dylib missing (ort-load-dynamic);
        // catch unwind and degrade to FTS instead of killing tokio worker.
        let apply = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.apply_embedding_config()?;
            if mode == "fastembed" {
                // backfill triggers first model load — may panic on missing libonnxruntime
                if let Err(e) = self.backfill_embeddings() {
                    // model unavailable (offline) — keep hybrid flag but engine will report unavailable
                    eprintln!("[memory] backfill skipped: {e}");
                }
            }
            Result::<(), MemoryError>::Ok(())
        }));
        match apply {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let msg = e.to_string();
                eprintln!("[memory] embedding setup failed: {msg}");
                self.config.embedding = "none".into();
                let _ = save_embedding("none");
                *self.embed.lock().unwrap() =
                    crate::daemon::memory_embed::EmbedEngine::new_disabled_with_reason(msg);
                let _ = self.write_embedding_meta(false);
            }
            Err(_) => {
                let msg = "ONNX Runtime unavailable (libonnxruntime missing — brew install onnxruntime; if already installed, re-select fastembed — no restart needed, or restart warpforge so ORT_DYLIB_PATH picks up /opt/homebrew/lib/libonnxruntime.dylib) — falling back to FTS";
                eprintln!("[memory] {msg}");
                self.config.embedding = "none".into();
                let _ = save_embedding("none");
                *self.embed.lock().unwrap() =
                    crate::daemon::memory_embed::EmbedEngine::new_disabled_with_reason(msg);
                let _ = self.write_embedding_meta(false);
            }
        }
        self.stats()
    }
    /// Recompute vectors for every existing memory (after enabling embeddings).
    /// No-op when the model is unavailable.
    fn backfill_embeddings(&self) -> Result<(), MemoryError> {
        let conn = self.guard()?;
        // memories_vec may not exist if apply failed — ignore
        let _ = conn.execute("DELETE FROM memories_vec", []);
        let rows: Vec<(i64, String)> = {
            let mut stmt = conn.prepare("SELECT rowid, content FROM memories")?;
            let mapped = stmt.query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (rowid, content) in rows {
            // index_embedding already catches panics and degrades to no-op
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = self.index_embedding(conn, rowid, &content);
            }));
            // if engine became unavailable, stop backfilling
            if self.embed.lock().unwrap().unavailable_reason().is_some() {
                break;
            }
        }
        Ok(())
    }
    /// Whether the vec table exists and should be written to. `false` when
    /// embeddings are off, which keeps `DELETE FROM memories_vec` from erroring
    /// on a store whose vec table was never created (e.g. `open_at(":memory:")`).
    pub(super) fn embeddings_active(&self) -> bool {
        self.embed.lock().unwrap().is_enabled()
    }
    /// Insert a vector for a stored memory. Silently no-ops when embeddings are
    /// disabled or the model is unavailable.
    pub(super) fn index_embedding(
        &self,
        conn: &Connection,
        rowid: i64,
        content: &str,
    ) -> Result<(), MemoryError> {
        let vec = {
            let mut engine = self.embed.lock().unwrap();
            if !engine.is_enabled() {
                return Ok(());
            }
            match engine.embed(&[content]) {
                Some(embeddings) => embeddings.into_iter().next(),
                None => return Ok(()),
            }
        };
        let Some(vec) = vec else { return Ok(()) };
        let blob = f32_to_blob(&vec);
        conn.execute(
            "INSERT OR REPLACE INTO memories_vec (rowid, embedding) VALUES (?1, ?2)",
            params![rowid, blob],
        )?;
        Ok(())
    }
}
