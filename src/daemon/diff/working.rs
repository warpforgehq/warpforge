//! The working-tree read the Changes rail is built on: tracked changes,
//! untracked files, and `.gitignore`'d paths, each answered separately so the
//! UI can group them and tell "none" apart from "could not scan".

use anyhow::{bail, Result};
use tokio::process::Command;
use warpforge_protocol as wire;

use super::errline;
use super::parse::parse_unified;

/// Working-tree diff for a git repo, tracked changes only (`git diff HEAD`).
/// Returns empty (Ok) if it isn't a repo, or has no commits yet.
pub async fn tracked_diff(repo: &str) -> Result<Vec<wire::FileDiff>> {
    let out = Command::new("git")
        .args(["-C", repo, "diff", "HEAD", "--no-color", "--no-ext-diff"])
        .output()
        .await?;
    Ok(if out.status.success() {
        parse_unified(&String::from_utf8_lossy(&out.stdout))
    } else {
        Vec::new()
    })
}

/// Untracked files, each as a whole-file addition. `Err` means the scan
/// itself failed (e.g. the repo became unreadable) — distinct from "no
/// untracked files", which is `Ok(vec![])`.
pub async fn untracked_diff(repo: &str) -> Result<Vec<wire::FileDiff>> {
    let out = Command::new("git")
        .args(["-C", repo, "ls-files", "--others", "--exclude-standard"])
        .output()
        .await?;
    if !out.status.success() {
        bail!(errline(&out));
    }
    let mut files = Vec::new();
    for name in String::from_utf8_lossy(&out.stdout).lines() {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(std::path::Path::new(repo).join(name)) else {
            continue;
        };
        let lines: Vec<String> = content.lines().map(|l| format!("+{l}")).collect();
        let new_lines = lines.len() as u32;
        files.push(wire::FileDiff {
            path: name.to_string(),
            old_path: None,
            status: wire::FileDiffStatus::Added,
            hunks: vec![wire::Hunk {
                old_start: 0,
                old_lines: 0,
                new_start: 1,
                new_lines,
                lines,
                resolution: None,
            }],
        });
    }
    Ok(files)
}

/// Safety cap for the ignored-files listing: a repo with `node_modules` +
/// `target` can otherwise report 100k rows (7MB of JSON), which froze the
/// client render. Directory collapsing (see `ignored_files`) keeps real
/// listings tiny; this only guards pathological piles of loose files.
pub const IGNORED_LIST_CAP: usize = 1000;

/// `.gitignore`'d paths (the "Show Ignored Files" toggle). No diff content —
/// the panel only needs the path to list them.
///
/// `--directory` collapses a wholly-ignored dir to one `dir/` entry instead
/// of descending into it (`node_modules/` = 1 row, not 41,497). Entries
/// ending in `/` are such collapsed dirs: the UI renders them as leaves and
/// never expands them — same as JetBrains. Returns `(paths, truncated)`.
pub async fn ignored_files(repo: &str) -> Result<(Vec<String>, bool)> {
    let out = Command::new("git")
        .args([
            "-C",
            repo,
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ])
        .output()
        .await?;
    if !out.status.success() {
        bail!(errline(&out));
    }
    let mut paths: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .take(IGNORED_LIST_CAP + 1)
        .collect();
    let truncated = paths.len() > IGNORED_LIST_CAP;
    paths.truncate(IGNORED_LIST_CAP);
    Ok((paths, truncated))
}

/// Working-tree diff for a git repo: tracked changes plus untracked files as
/// whole-file additions. Returns empty (Ok) if it isn't a repo. Used for the
/// review/fix workflow prompts, which want one flat list; the `diff.get` RPC
/// keeps tracked and untracked separate (see `tracked_diff`/`untracked_diff`).
pub async fn working_diff(repo: &str) -> Result<Vec<wire::FileDiff>> {
    let mut files = tracked_diff(repo).await?;
    files.extend(untracked_diff(repo).await.unwrap_or_default());
    Ok(files)
}

/// Append paths to the repo's root `.gitignore` ("Add to .gitignore" for
/// unversioned files). Lines already present are never duplicated, and a
/// missing `.gitignore` is created. Refuses `..` escapes and blank lines —
/// both are caller bugs, not ignore rules.
pub async fn ignore_paths(repo: &str, paths: &[String]) -> Result<()> {
    use std::collections::BTreeSet;
    if paths.is_empty() {
        bail!("nothing to ignore");
    }
    for p in paths {
        let p = p.trim();
        if p.is_empty() || p.contains("..") {
            bail!("refusing ignore entry: {p}");
        }
    }
    let ignore_file = std::path::Path::new(repo).join(".gitignore");
    let existing = std::fs::read_to_string(&ignore_file).unwrap_or_default();
    let mut lines: BTreeSet<&str> = existing.lines().map(str::trim).collect();
    let mut additions = Vec::new();
    for p in paths {
        let p = p.trim();
        if !lines.contains(p) {
            lines.insert(p);
            additions.push(p);
        }
    }
    if additions.is_empty() {
        return Ok(());
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    for a in additions {
        text.push_str(a);
        text.push('\n');
    }
    std::fs::write(&ignore_file, text)?;
    Ok(())
}

/// Current branch of a git repo (`HEAD` short name), or None if not a repo or
/// detached.
pub async fn current_branch(repo: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo, "symbolic-ref", "--short", "-q", "HEAD"])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::super::rev_parse_head;
    use super::super::testsupport::{git, init_repo};
    use super::*;

    #[tokio::test]
    async fn split_separates_tracked_untracked_and_ignored() {
        let dir = std::env::temp_dir().join(format!("wf-split-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("tracked.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        std::fs::write(dir.join("tracked.txt"), "one\nmodified\n").unwrap();
        std::fs::write(dir.join("new.txt"), "brand new\n").unwrap();
        std::fs::write(dir.join(".gitignore"), "ignored.log\n").unwrap();
        std::fs::write(dir.join("ignored.log"), "noise\n").unwrap();

        let tracked = tracked_diff(repo).await.unwrap();
        assert_eq!(tracked.len(), 1);
        assert_eq!(tracked[0].path, "tracked.txt");
        assert_eq!(tracked[0].status, wire::FileDiffStatus::Modified);

        let untracked = untracked_diff(repo).await.unwrap();
        let mut untracked_paths: Vec<_> = untracked.iter().map(|f| f.path.as_str()).collect();
        untracked_paths.sort();
        assert_eq!(
            untracked_paths,
            vec![".gitignore", "new.txt"],
            "ignored.log is excluded by --exclude-standard, the rest is untracked"
        );

        let ignored = ignored_files(repo).await.unwrap();
        assert_eq!(ignored, (vec!["ignored.log".to_string()], false));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignored_files_empty_when_none_ignored() {
        let dir = std::env::temp_dir().join(format!("wf-noignore-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        assert!(ignored_files(repo).await.unwrap().0.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignored_files_collapses_wholly_ignored_dirs() {
        // `node_modules/` with 50 files inside must come back as ONE `dir/`
        // entry — this is what kept the real repo's 99,971-row listing (7MB
        // of JSON) from ever reaching the client again.
        let dir = std::env::temp_dir().join(format!("wf-igndir-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("keep.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
        for i in 0..50 {
            std::fs::write(dir.join(format!("node_modules/dep/f{i}.js")), "x\n").unwrap();
        }
        std::fs::write(dir.join(".gitignore"), "node_modules/\nloose.log\n").unwrap();
        std::fs::write(dir.join("loose.log"), "noise\n").unwrap();

        let (paths, truncated) = ignored_files(repo).await.unwrap();
        assert!(!truncated);
        assert!(
            paths.contains(&"node_modules/".to_string()),
            "collapsed dir entry, got: {paths:?}"
        );
        assert!(paths.contains(&"loose.log".to_string()));
        assert!(
            !paths.iter().any(|p| p.starts_with("node_modules/dep/")),
            "must not descend into the collapsed dir, got: {paths:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignored_files_truncates_loose_piles_at_cap() {
        // Thousands of loose ignored files (no shared dir to collapse) must
        // stop at IGNORED_LIST_CAP with truncated=true, not flood the client.
        let dir = std::env::temp_dir().join(format!("wf-igncap-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("keep.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        std::fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
        for i in 0..(IGNORED_LIST_CAP + 100) {
            std::fs::write(dir.join(format!("f{i}.log")), "noise\n").unwrap();
        }

        let (paths, truncated) = ignored_files(repo).await.unwrap();
        assert_eq!(paths.len(), IGNORED_LIST_CAP);
        assert!(truncated);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignore_paths_appends_without_duplicating() {
        let dir = std::env::temp_dir().join(format!("wf-ignore-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join(".gitignore"), "old.log\nno-trailing-newline").unwrap();

        ignore_paths(repo, &["new.log".to_string(), "old.log".to_string()])
            .await
            .unwrap();

        let text = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(text.lines().filter(|l| *l == "old.log").count(), 1);
        assert!(text.lines().any(|l| l == "new.log"));
        assert!(text.ends_with('\n'));

        // Second run is a no-op, not a duplicate.
        ignore_paths(repo, &["new.log".to_string()]).await.unwrap();
        let again = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(text, again);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignore_paths_creates_a_missing_gitignore() {
        let dir = std::env::temp_dir().join(format!("wf-ignorenew-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();

        ignore_paths(repo, &["secret.env".to_string()])
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join(".gitignore")).unwrap(),
            "secret.env\n"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn ignore_paths_refuses_escapes_blanks_and_empty_lists() {
        let dir = std::env::temp_dir().join(format!("wf-ignoreneg-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();

        assert!(ignore_paths(repo, &[]).await.is_err());
        assert!(ignore_paths(repo, &["../evil".to_string()]).await.is_err());
        assert!(ignore_paths(repo, &["   ".to_string()]).await.is_err());
        assert!(!dir.join(".gitignore").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn untracked_diff_errs_when_repo_unreadable() {
        // Not a git repo at all: `git ls-files` exits non-zero, and the split
        // must surface that as "unavailable" rather than "zero files".
        let dir = std::env::temp_dir().join(format!("wf-notrepo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        assert!(untracked_diff(repo).await.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn empty_repo_has_no_tracked_or_untracked_changes() {
        let dir = std::env::temp_dir().join(format!("wf-empty-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();

        assert!(tracked_diff(repo).await.unwrap().is_empty());
        assert!(untracked_diff(repo).await.unwrap().is_empty());
        assert!(ignored_files(repo).await.unwrap().0.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn current_branch_none_when_detached() {
        let dir = std::env::temp_dir().join(format!("wf-detached-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        let head = rev_parse_head(repo).await.unwrap();
        git(&dir, &["checkout", "-q", &head]).await;

        assert_eq!(current_branch(repo).await, None);

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── git.roots ────────────────────────────────────────────────────────────
}
