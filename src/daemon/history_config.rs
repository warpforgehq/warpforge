//! Task-history retention: the `history:` section of `~/.warpforge/config.yaml`.
//!
//! The lifecycle of a finished task, in order:
//! 1. `retention_days` (default 30) — after this long, a *closed* task keeps
//!    its title, prompt and diff, but its conversation transcript is deleted.
//! 2. `settle_ignored_after_days` (default 14) — a `waiting` task with no diff
//!    that nobody touched for this long is settled automatically (moved to
//!    Closed; reversible). Tasks with a diff are never settled automatically.
//! 3. `delete_closed_after_days` (default 90) — a closed task nobody touched
//!    for this long is deleted entirely: row, transcript, worktree. Commits
//!    stay in git. Tasks that still hold unmerged changes are kept.
//!
//! Every sweep runs at daemon start, once a day, and when a value changes —
//! and each sweep that deleted or moved something announces it as an event,
//! so pruning is never silent. `0` disables a stage.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

fn default_retention_days() -> u32 {
    30
}

fn default_settle_ignored_days() -> u32 {
    14
}

fn default_delete_closed_days() -> u32 {
    90
}

/// The `history:` block. Missing keys resolve to the defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryConfig {
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
    #[serde(default = "default_settle_ignored_days")]
    pub settle_ignored_after_days: u32,
    #[serde(default = "default_delete_closed_days")]
    pub delete_closed_after_days: u32,
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            retention_days: default_retention_days(),
            settle_ignored_after_days: default_settle_ignored_days(),
            delete_closed_after_days: default_delete_closed_days(),
        }
    }
}

impl HistoryConfig {
    pub fn load() -> Self {
        super::config_file::load_section("history")
    }
}

/// Persist the retention settings to `~/.warpforge/config.yaml`, preserving
/// any unrelated top-level keys. Best-effort for pruning, but the settings
/// RPC surfaces failures.
pub fn save(config: &HistoryConfig) -> Result<()> {
    super::config_file::update_section("history", |history| {
        history.insert(
            Value::String("retention_days".into()),
            Value::Number(config.retention_days.into()),
        );
        history.insert(
            Value::String("settle_ignored_after_days".into()),
            Value::Number(config.settle_ignored_after_days.into()),
        );
        history.insert(
            Value::String("delete_closed_after_days".into()),
            Value::Number(config.delete_closed_after_days.into()),
        );
    })
}
