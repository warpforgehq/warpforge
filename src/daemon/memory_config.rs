//! Memory configuration: the `memory:` section of `~/.warpforge/config.yaml`.
//! Loaded once at daemon start; the dreaming subsection is parsed and stored
//! but never executed in v1.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

fn default_embedding() -> String {
    "none".into()
}

fn default_dream_agent() -> String {
    "opencode".into()
}

fn default_dream_trigger() -> String {
    "manual".into()
}

fn default_dream_cron() -> String {
    "0 3 * * *".into()
}

fn default_dream_idle() -> String {
    "30m".into()
}

/// The `memory:` block. Missing keys resolve to the v1 defaults (everything
/// enabled, FTS-only, `embedding: "none"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub global: bool,
    #[serde(default = "default_true")]
    pub project: bool,
    #[serde(default = "default_embedding")]
    pub embedding: String,
    #[serde(default)]
    pub per_project: Option<bool>,
    #[serde(default)]
    pub dreaming: DreamingConfig,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            global: true,
            project: true,
            embedding: "none".into(),
            per_project: None,
            dreaming: DreamingConfig::default(),
        }
    }
}

impl MemoryConfig {
    pub fn load() -> Self {
        super::config_file::load_section("memory")
    }

    /// Whether embeddings are requested (`embedding: "fastembed"`).
    pub fn embeddings_enabled(&self) -> bool {
        self.embedding == "fastembed"
    }
}

/// Persist the embedding mode to `~/.warpforge/config.yaml`, preserving any
/// unrelated top-level keys. Best-effort: callers treat failure as non-fatal.
pub fn save_embedding(mode: &str) -> Result<()> {
    super::config_file::update_section("memory", |memory| {
        memory.insert(
            Value::String("embedding".into()),
            Value::String(mode.into()),
        );
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamingConfig {
    #[serde(default = "default_false")]
    pub enabled: bool,
    #[serde(default = "default_dream_agent")]
    pub agent: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "default_dream_trigger")]
    pub trigger: String,
    #[serde(default = "default_dream_cron")]
    pub cron: String,
    #[serde(default = "default_dream_idle")]
    pub idle_after: String,
}

impl Default for DreamingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            agent: "opencode".into(),
            model: None,
            trigger: "manual".into(),
            cron: "0 3 * * *".into(),
            idle_after: "30m".into(),
        }
    }
}

impl DreamingConfig {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
    pub fn idle_duration(&self) -> std::time::Duration {
        crate::daemon::memory_dream::parse_idle_after(&self.idle_after)
    }
    pub fn effective_model(&self, fallback: Option<&str>) -> Option<String> {
        self.model
            .clone()
            .or_else(|| fallback.map(|s| s.to_string()))
    }
}
