//! The personal, uncommitted `workspace.local.yaml` that overrides the shared
//! workspace config. Merge rules: see `merge.rs`; git hygiene: `ignore.rs`.

mod ignore;
mod merge;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_yaml::Value;

use crate::config::{find_config_file, validate_worktree, WorkspaceConfig, CONFIG_NAMES};

pub(crate) use ignore::ensure_local_ignored;

/// Which services and port-forwards the local file added or changed, with the
/// fields it set on each.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalOverrides {
    pub services: BTreeMap<String, Vec<String>>,
    pub portforwards: BTreeMap<String, Vec<String>>,
    pub fields: Vec<Vec<String>>,
}

/// Prefer the active overlay when applying git hygiene, including when legacy
/// overlays remain on disk after a migration.
pub(crate) fn find_local_config_file(project_path: &Path) -> Option<PathBuf> {
    let active = local_config_path(&find_config_file(project_path));
    if active.is_file() {
        return Some(active);
    }
    CONFIG_NAMES
        .iter()
        .map(|name| local_config_path(&project_path.join(name)))
        .find(|path| path.is_file())
}

pub(crate) fn local_config_path(shared_path: &Path) -> PathBuf {
    shared_path.with_extension("local.yaml")
}

pub(crate) fn merge_text(
    local_path: &Path,
    shared_text: Option<&str>,
    shared: Option<&WorkspaceConfig>,
    local_text: &str,
) -> Result<Option<WorkspaceConfig>> {
    let local: Value = serde_yaml::from_str(local_text).context("parsing local config")?;
    if local.is_null() {
        return Ok(None);
    }
    let base: Value = match shared_text {
        Some(text) => serde_yaml::from_str(text)?,
        None => serde_yaml::to_value(shared.cloned().unwrap_or_default())?,
    };
    let (merged, overrides) = merge::merge_config(base, local).context("merging local config")?;
    let mut config: WorkspaceConfig =
        serde_yaml::from_value(merged).context("applying local config")?;
    validate_worktree(&config, local_path)?;
    config.local = overrides;
    Ok(Some(config))
}
