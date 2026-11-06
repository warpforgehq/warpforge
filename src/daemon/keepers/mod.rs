//! Keepers (ADR 0030), the pure half: `.warpforge/keepers/*.yaml` parsing
//! and validation, the built-in presets, and the per-task state the actor
//! mirrors. The actor glue lives in `actor/keepers/`.

mod parse;
mod presets;
mod registry;
mod state;
#[cfg(test)]
mod tests;

pub use parse::parse_keeper;
pub use registry::list_keepers;
pub use state::{precision, KeeperState};

use std::path::{Path, PathBuf};

/// @param project_path the project's root
/// @returns where its keeper files live
pub fn keepers_dir(project_path: &Path) -> PathBuf {
    project_path.join(".warpforge").join("keepers")
}

pub const SUPPORTED_VERSION: u64 = 1;
pub const DEFAULT_TIME_LIMIT_SECS: u64 = 15 * 60;
pub const TIME_LIMIT_CAP_SECS: u64 = 60 * 60;
pub const DEFAULT_MAX_ROUNDS: u32 = 3;
pub const MAX_ROUNDS_CAP: u32 = 5;
/// How many resolved findings, newest first, precision is computed over.
pub const PRECISION_WINDOW: usize = 50;

/// Placeholders a keeper prompt may use; anything else is a load error.
pub const PROMPT_VARS: &[&str] = &[
    "name",
    "task_title",
    "task_brief",
    "diff",
    "commits",
    "dismissed",
    "rules",
];
