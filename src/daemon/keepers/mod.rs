//! Keepers (ADR 0030), the pure half: `.warpforge/keepers/*.yaml` parsing
//! and validation, the built-in presets, and the per-task state the actor
//! mirrors. The actor glue lives in `actor/keepers/`.

mod debounce;
mod fix;
mod git;
mod outcome;
mod parse;
mod paths;
mod presets;
mod prompt;
mod registry;
mod reply;
mod state;
#[cfg(test)]
mod tests;

pub use debounce::HeadWatch;
pub use fix::{fix_prompt, owner_fix_prompt, stop_rule, FixItem};
#[cfg(test)]
pub use git::Scripted;
pub use git::{Change, ChangeQuery, GitSource};
pub use outcome::{map_result, meets, Mapped};
pub use parse::parse_keeper;
pub use paths::touches;
pub use presets::list_presets;
pub use prompt::{commits_since, dismissed_list, reask_prompt, render_prompt, PromptVars};
pub use registry::list_keepers;
pub use reply::parse_replies;
pub use state::{precision, KeeperState};

use std::path::{Path, PathBuf};
use std::time::Duration;

/// How often eligible tasks' HEADs are read.
pub const POLL_INTERVAL: Duration = Duration::from_secs(20);
/// How long a new HEAD must stay put before it is checked, unless a turn
/// ended or a commit was made through Warpforge.
pub const SETTLE: Duration = Duration::from_secs(60);
/// Checker sessions running at once, across the daemon.
pub const MAX_CHECKERS: usize = 4;
/// `KeeperRun::error` of a run skipped because the quota gate refused it;
/// such a run does not count as a check of its HEAD.
pub const QUOTA_SKIP: &str = "quota";
pub const SUPERSEDED: &str = "superseded";
/// `KeeperRun::error` of a run the previous daemon left unfinished; its HEAD
/// is checked again.
pub const RESTARTED: &str = "the daemon restarted during the check";

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
