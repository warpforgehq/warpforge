use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};

use super::find_local_config_file;

const HEADER: &str = "# Created by Warpforge automatically: personal overrides stay out of git.\n";

/// Keep the local override file out of git so it never shows as untracked.
/// Best-effort and idempotent; a no-op without a local file.
///
/// @param project_path Project root.
pub(crate) fn ensure_local_ignored(project_path: &Path) {
    let Some(local) = find_local_config_file(project_path) else {
        return;
    };
    if let Err(e) = ignore(project_path, &local) {
        eprintln!("[daemon] could not ignore {}: {e:#}", local.display());
    }
}

/// `.warpforge/.gitignore` for the file in `.warpforge/`; the clone's
/// `info/exclude` for a legacy root-level file. Never the root `.gitignore`.
fn ignore(project_path: &Path, local: &Path) -> Result<()> {
    let file_name = local.file_name().unwrap_or_default().to_string_lossy();
    if local.parent() == Some(&project_path.join(".warpforge")) {
        let gitignore =
            crate::config::resolve_config_path(project_path, &local.with_file_name(".gitignore"))?;
        return ignore_beside(&gitignore, &file_name);
    }
    match exclude_file(project_path)? {
        Some(exclude) => append_line(&exclude, &format!("/{file_name}")),
        None => Ok(()),
    }
}

fn ignore_beside(gitignore: &Path, file_name: &str) -> Result<()> {
    if !gitignore.exists() {
        let content = format!("{HEADER}{file_name}\n.gitignore\n");
        return fs::write(gitignore, content)
            .with_context(|| format!("writing {}", gitignore.display()));
    }
    append_line(gitignore, file_name)
}

fn append_line(path: &Path, line: &str) -> Result<()> {
    let existing = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e).with_context(|| format!("reading {}", path.display())),
    };
    let bare = line.trim_start_matches('/');
    if existing
        .lines()
        .any(|l| l.trim().trim_start_matches('/') == bare)
    {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    fs::write(path, format!("{existing}{separator}{line}\n"))
        .with_context(|| format!("writing {}", path.display()))
}

fn exclude_file(project_path: &Path) -> Result<Option<PathBuf>> {
    let output = Command::new("git")
        .args(["rev-parse", "--git-path", "info/exclude"])
        .current_dir(project_path)
        .output()
        .context("failed to run git rev-parse --git-path")?;
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || raw.is_empty() {
        return Ok(None);
    }
    Ok(Some(if Path::new(&raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_path.join(raw)
    }))
}
