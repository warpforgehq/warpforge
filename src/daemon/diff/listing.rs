//! Project file listing for the editor tree: git's view of the checkout when
//! it is a repo, a filesystem walk when it is not.

use anyhow::Result;
use tokio::process::Command;
use warpforge_protocol as wire;

use super::working::working_diff;
use super::{HEAVY_DIRS, IGNORED_NAMES};

/// Project files for the editor tree. Prefer git's view (tracked +
/// untracked); fall back to a small filesystem walk for non-git projects.
/// `include_ignored` keeps .gitignore'd paths in the list.
pub async fn list_files(repo: &str, include_ignored: bool) -> Result<Vec<wire::ProjectFile>> {
    let mut args = vec!["-C", repo, "ls-files", "--cached", "--others"];
    if !include_ignored {
        args.push("--exclude-standard");
    }
    let out = Command::new("git").args(&args).output().await?;

    // Both paths below stat every file in the project. That is synchronous
    // work, and left on a runtime worker it stalls whatever shares the thread —
    // it was measurably delaying the next request on the same connection. Hand
    // it to the blocking pool (ADR 0002).
    let repo = repo.to_string();
    if out.status.success() {
        let changed = working_diff(&repo)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|f| f.path)
            .collect::<std::collections::HashSet<_>>();
        return tokio::task::spawn_blocking(move || {
            let mut files = Vec::new();
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let path = line.trim();
                if path.is_empty() {
                    continue;
                }
                let full = std::path::Path::new(&repo).join(path);
                if path.ends_with('/') || full.is_dir() {
                    // `git ls-files` collapses untracked directories to a
                    // "dir/" entry and never descends into nested git repos
                    // (submodule gitlinks). Walk them on the filesystem so
                    // their contents appear in the tree.
                    let _ = walk_files(std::path::Path::new(&repo), &full, &mut files);
                    continue;
                }
                if full.exists() && !is_ignored_path(path) {
                    files.push(wire::ProjectFile {
                        path: path.to_string(),
                        changed: changed.contains(path),
                    });
                }
            }
            files.sort_by(|a, b| a.path.cmp(&b.path));
            files
        })
        .await
        .map_err(anyhow::Error::from);
    }

    tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        walk_files(
            std::path::Path::new(&repo),
            std::path::Path::new(&repo),
            &mut files,
        )?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    })
    .await?
}

pub fn is_ignored_path(path: &str) -> bool {
    if path.split('/').any(|part| HEAVY_DIRS.contains(&part)) {
        return true;
    }
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    IGNORED_NAMES.iter().any(|pat| {
        if let Some(ext) = pat.strip_prefix("*.") {
            name.ends_with(ext)
        } else if let Some(prefix) = pat.strip_prefix(".*") {
            name == prefix || name.starts_with(&format!(".{prefix}"))
        } else if pat.ends_with('/') {
            path.starts_with(pat)
        } else {
            name == *pat
        }
    })
}

fn walk_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<wire::ProjectFile>,
) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if HEAVY_DIRS.contains(&name.as_ref()) {
            continue;
        }
        if path.is_dir() {
            walk_files(root, &path, out)?;
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if !is_ignored_path(&rel) {
                    out.push(wire::ProjectFile {
                        path: rel,
                        changed: false,
                    });
                }
            }
        }
    }
    Ok(())
}
