use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

use super::{auto_detect, WorkspaceConfig};
use crate::config_local::{local_config_path, merge_text};

pub(crate) const CONFIG_NAMES: &[&str] = &[
    ".warpforge/workspace.yaml",
    ".warpforge.yaml",
    ".wf.yaml",
    ".workspace.yaml",
];

pub(super) fn config_present(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) => !matches!(
            error.kind(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
        ),
    }
}

pub(crate) fn find_config_file(project_path: &Path) -> PathBuf {
    CONFIG_NAMES
        .iter()
        .map(|name| project_path.join(name))
        .find(|path| config_present(path))
        .unwrap_or_else(|| project_path.join(CONFIG_NAMES[0]))
}

pub(crate) fn read_config_text(root: &Path, path: &Path) -> Result<Option<String>> {
    if !config_present(path) {
        return Ok(None);
    }
    let target = resolve_config_path(root, path)?;
    let reading = || format!("reading {}", path.display());
    anyhow::ensure!(
        fs::metadata(&target).with_context(reading)?.is_file(),
        "{} is not a file",
        path.display()
    );
    fs::read_to_string(target).with_context(reading).map(Some)
}

pub(crate) fn resolve_config_path(root: &Path, path: &Path) -> Result<PathBuf> {
    let relative = path.strip_prefix(root)?;
    crate::daemon::diff::resolve_target_in_root(
        &root.to_string_lossy(),
        &relative.to_string_lossy(),
    )
}

pub(crate) fn load_shared(
    project_path: &Path,
    shared_path: &Path,
    text: Option<&str>,
) -> Result<Option<WorkspaceConfig>> {
    let Some(text) = text else {
        return Ok(auto_detect(project_path));
    };
    let config =
        serde_yaml::from_str(text).with_context(|| format!("parsing {}", shared_path.display()))?;
    validate_worktree(&config, shared_path)?;
    Ok(Some(config))
}

pub(crate) fn validate_worktree(config: &WorkspaceConfig, path: &Path) -> Result<()> {
    if let Some(worktree) = &config.worktree {
        worktree
            .validate()
            .with_context(|| format!("validating {}", path.display()))?;
    }
    Ok(())
}

pub(crate) fn load_local(
    project_path: &Path,
    local_path: &Path,
    shared_text: Option<&str>,
    shared: Option<WorkspaceConfig>,
    local_text: Result<Option<&str>>,
) -> Option<WorkspaceConfig> {
    let relative = local_path.strip_prefix(project_path).unwrap_or(local_path);
    let merged = local_text.and_then(|text| match text {
        Some(text) => merge_text(relative, shared_text, shared.as_ref(), text),
        None => Ok(None),
    });
    match merged {
        Ok(Some(config)) => Some(config),
        Ok(None) => shared,
        Err(error) => Some(WorkspaceConfig {
            local_error: Some(format!("{}: {error:#}", relative.display())),
            ..shared.unwrap_or_default()
        }),
    }
}

pub fn try_load_workspace_config(project_path: &Path) -> Result<Option<WorkspaceConfig>> {
    let shared_path = find_config_file(project_path);
    let text = read_config_text(project_path, &shared_path)?;
    let shared = load_shared(project_path, &shared_path, text.as_deref())?;
    let local_path = local_config_path(&shared_path);
    let local = read_config_text(project_path, &local_path);
    Ok(load_local(
        project_path,
        &local_path,
        text.as_deref(),
        shared,
        local
            .as_ref()
            .map(|text| text.as_deref())
            .map_err(|error| anyhow::anyhow!("{error:#}")),
    ))
}

pub fn load_workspace_config(project_path: &Path) -> Option<WorkspaceConfig> {
    try_load_workspace_config(project_path).ok().flatten()
}
