//! Project file listing for the editor tree: git's view of the checkout when
//! it is a repo, a filesystem walk when it is not.

use anyhow::Result;
use tokio::process::Command;
use warpforge_protocol as wire;

use super::working::working_diff;
use super::{is_worktree_path, HEAVY_DIRS, IGNORED_NAMES};

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
                // Pure string check, so ignored trees never pay a stat or a walk.
                if is_ignored_path(path) {
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
                if full.exists() {
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
    if is_worktree_path(path) {
        return true;
    }
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
            if let Ok(rel) = path.strip_prefix(root) {
                if is_worktree_path(&rel.to_string_lossy().replace('\\', "/")) {
                    continue;
                }
            }
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

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    #[test]
    fn worktrees_paths_are_ignored() {
        assert!(is_ignored_path(".worktrees/t_a/src/main.rs"));
        assert!(is_ignored_path(".worktrees/t_a/"));
        assert!(is_ignored_path(".warpforge/worktrees/t_a/src/main.rs"));
        assert!(is_ignored_path(".warpforge/worktrees/t_a/"));
        // A bare `worktrees` folder elsewhere is not Warpforge's, and must stay.
        assert!(!is_ignored_path("src/worktrees/mod.rs"));
    }

    #[tokio::test]
    async fn list_files_skips_ignored_dirs_before_walking() {
        let dir = std::env::temp_dir().join(format!("wf-listing-ignored-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        // git collapses the nested repo to a "node_modules/pkg/" directory
        // entry, the shape that would otherwise be walked.
        let pkg = dir.join("node_modules").join("pkg");
        init_repo(&pkg).await;
        std::fs::write(pkg.join("index.js"), "x\n").unwrap();
        std::fs::create_dir_all(dir.join("node_modules/loose")).unwrap();
        std::fs::write(dir.join("node_modules/loose/b.js"), "x\n").unwrap();

        let files = list_files(repo, true).await.unwrap();
        assert_eq!(
            files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            vec!["a.txt"]
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn list_files_skips_task_worktrees() {
        let dir = std::env::temp_dir().join(format!("wf-listing-wt-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        let nested = dir.join(".worktrees").join("t_abc");
        init_repo(&nested).await;
        std::fs::write(nested.join("secret.txt"), "x\n").unwrap();

        let files = list_files(repo, true).await.unwrap();
        assert!(
            !files.iter().any(|f| f.path.contains(".worktrees")),
            "task worktrees must not appear in the tree: {:?}",
            files.iter().map(|f| &f.path).collect::<Vec<_>>()
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn list_files_skips_new_location_task_worktrees() {
        let dir = std::env::temp_dir().join(format!("wf-listing-wt2-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        let nested = dir.join(".warpforge").join("worktrees").join("t_abc");
        init_repo(&nested).await;
        std::fs::write(nested.join("secret.txt"), "x\n").unwrap();

        let files = list_files(repo, true).await.unwrap();
        assert!(
            !files.iter().any(|f| f.path.contains("worktrees")),
            "task worktrees must not appear in the tree: {:?}",
            files.iter().map(|f| &f.path).collect::<Vec<_>>()
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
