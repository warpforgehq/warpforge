//! `dir.list`: one directory's children, classified, never descended into.

use std::path::Path;
use std::sync::Arc;

use anyhow::{bail, Result};
use tokio::sync::Semaphore;
use warpforge_protocol as wire;

use super::{Class, IgnoreStack, TrackedIgnored};
use crate::daemon::diff::resolve_target_in_root;

pub(crate) const DIR_LIST_CAP: usize = 5000;

/// Bounds the blocking pool threads a burst of expands can take (ADR 0028).
static PERMITS: Semaphore = Semaphore::const_new(8);

/// Lists the directory at `path` (relative, empty for the root) under `root`;
/// `tracked` comes from [`super::status::StatusRuns::tracked_ignored`].
pub(crate) async fn dir_list(
    root: &str,
    path: &str,
    tracked: Arc<TrackedIgnored>,
) -> Result<wire::DirListing> {
    let rel = path.trim_matches('/').to_string();
    let dir = if rel.is_empty() {
        std::fs::canonicalize(root)?
    } else {
        resolve_target_in_root(root, &rel)?
    };
    let mut stack = IgnoreStack::open(Path::new(root))
        .await
        .with_tracked(tracked);
    let _permit = PERMITS.acquire().await?;
    tokio::task::spawn_blocking(move || list_blocking(&mut stack, &dir, &rel, DIR_LIST_CAP)).await?
}

fn list_blocking(
    stack: &mut IgnoreStack,
    dir: &Path,
    rel: &str,
    cap: usize,
) -> Result<wire::DirListing> {
    if !rel.is_empty() && stack.classify(rel, true) == Class::Hidden {
        bail!("refusing to list a hidden directory: {rel}");
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let symlink = file_type.is_symlink();
        let is_dir = if symlink {
            std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir())
        } else {
            file_type.is_dir()
        };
        let child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let ignored = match stack.classify(&child, is_dir) {
            Class::Hidden => continue,
            Class::Ignored => true,
            Class::Visible => false,
        };
        entries.push(wire::DirEntry {
            name,
            kind: if is_dir {
                wire::EntryKind::Dir
            } else {
                wire::EntryKind::File
            },
            symlink,
            ignored,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    let truncated = entries.len() > cap;
    entries.truncate(cap);
    Ok(wire::DirListing { entries, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::diff::testsupport::init_repo;

    fn write(root: &Path, rel: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    fn names(listing: &wire::DirListing) -> Vec<(&str, bool)> {
        listing
            .entries
            .iter()
            .map(|e| (e.name.as_str(), e.ignored))
            .collect()
    }

    async fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        std::fs::write(root.join(".gitignore"), ".env\ncoverage/\n").unwrap();
        for rel in [
            ".env",
            "coverage/lcov.info",
            "node_modules/pkg/index.js",
            "src/main.rs",
            ".DS_Store",
            ".warpforge/worktrees/t_1/a.rs",
            ".warpforge/workspace.yaml",
        ] {
            write(root, rel);
        }
        dir
    }

    #[tokio::test]
    async fn the_root_marks_ignored_and_drops_hidden() {
        let dir = repo().await;
        let listing = dir_list(dir.path().to_str().unwrap(), "", Arc::default())
            .await
            .unwrap();
        assert_eq!(
            names(&listing),
            [
                (".env", true),
                (".gitignore", false),
                (".warpforge", false),
                ("coverage", true),
                ("src", false),
            ]
        );
        assert!(!listing.truncated);
        assert_eq!(listing.entries[2].kind, wire::EntryKind::Dir);
    }

    #[tokio::test]
    async fn an_ignored_dir_lists_with_every_child_ignored() {
        let dir = repo().await;
        let root = dir.path().to_str().unwrap();
        let listing = dir_list(root, "coverage/", Arc::default()).await.unwrap();
        assert_eq!(names(&listing), [("lcov.info", true)]);
        let listing = dir_list(root, ".warpforge", Arc::default()).await.unwrap();
        assert_eq!(names(&listing), [("workspace.yaml", false)]);
    }

    #[tokio::test]
    async fn hidden_and_escaping_paths_are_refused() {
        let dir = repo().await;
        let root = dir.path().to_str().unwrap();
        for path in [
            "node_modules",
            ".git",
            ".warpforge/worktrees",
            "../",
            "/etc",
            "src/../..",
        ] {
            assert!(
                dir_list(root, path, Arc::default()).await.is_err(),
                "{path}"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlinks_report_their_target_and_never_leave_the_root() {
        let dir = repo().await;
        let outside = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::os::unix::fs::symlink(root.join("src"), root.join("src-link")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("out")).unwrap();
        let listing = dir_list(root.to_str().unwrap(), "", Arc::default())
            .await
            .unwrap();
        let link = listing
            .entries
            .iter()
            .find(|e| e.name == "src-link")
            .unwrap();
        assert!(link.symlink);
        assert_eq!(link.kind, wire::EntryKind::Dir);
        let listing = dir_list(root.to_str().unwrap(), "src-link", Arc::default())
            .await
            .unwrap();
        assert_eq!(names(&listing), [("main.rs", false)]);
        assert!(dir_list(root.to_str().unwrap(), "out", Arc::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn tracked_files_under_an_ignore_pattern_are_not_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        write(root, "build/keep.txt");
        crate::daemon::diff::testsupport::git(root, &["add", "."]).await;
        crate::daemon::diff::testsupport::git(root, &["commit", "-qm", "init"]).await;
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        write(root, "build/out.bin");
        let root = root.to_str().unwrap();
        let tracked = super::super::status::StatusRuns::default()
            .tracked_ignored(root)
            .await
            .unwrap();

        let listing = dir_list(root, "", tracked.clone()).await.unwrap();
        assert_eq!(names(&listing), [(".gitignore", false), ("build", false)]);
        let listing = dir_list(root, "build", tracked).await.unwrap();
        assert_eq!(names(&listing), [("keep.txt", false), ("out.bin", true)]);
    }

    #[tokio::test]
    async fn a_large_directory_is_truncated_after_sorting() {
        let dir = repo().await;
        let root = dir.path();
        for i in 0..5 {
            write(root, &format!("many/f{i}"));
        }
        let mut stack = IgnoreStack::open(root).await;
        let listing = list_blocking(&mut stack, &root.join("many"), "many", 3).unwrap();
        assert!(listing.truncated);
        assert_eq!(
            names(&listing),
            [("f0", false), ("f1", false), ("f2", false)]
        );
    }
}
