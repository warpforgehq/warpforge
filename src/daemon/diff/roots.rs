//! Multi-root discovery for `git.roots`: a project's own checkout plus any
//! nested git checkouts under it.

use anyhow::Result;
use warpforge_protocol as wire;

use super::working::current_branch;
use super::{git, HEAVY_DIRS};

/// How deep under a root to look for nested git checkouts. Bounded so a huge
/// `node_modules`-free tree can't turn this into an unbounded walk.
const MAX_NESTED_DEPTH: usize = 4;

/// Warpforge's own worktree dir: task checkouts, never a working root. Without
/// this, any repo with a live task shows the multi-root tree for no reason.
const SKIPPED_DIRS: &[&str] = &[".worktrees"];

/// This repo's toplevel plus any nested git checkouts found under it (plain
/// nested repos, not necessarily submodules), each with its branch and
/// remotes. A repo with no nested checkouts returns exactly one root. Empty
/// if `repo` isn't a git repo at all.
pub async fn git_roots(repo: &str) -> Result<Vec<wire::GitRoot>> {
    let out = git(repo, &["rev-parse", "--show-toplevel"]).await?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let primary = std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());

    let nested = {
        let base = primary.clone();
        tokio::task::spawn_blocking(move || {
            let mut found = Vec::new();
            find_nested_git_dirs(&base, &base, 0, &mut found);
            found
        })
        .await
        .unwrap_or_default()
    };

    // Nested checkouts under ignored paths (study clones, vendored trees)
    // are not working roots — without this, an ignored folder with clones in
    // it forces the multi-root tree on an otherwise single-root project.
    let ignored = ignored_paths(&primary, &nested).await;
    let nested: Vec<_> = nested
        .into_iter()
        .filter(|p| !ignored.contains(p.to_string_lossy().as_ref()))
        .collect();

    let mut roots = Vec::with_capacity(1 + nested.len());
    roots.push(root_entry(&primary, &primary).await);
    for path in nested {
        roots.push(root_entry(&primary, &path).await);
    }
    Ok(roots)
}

/// Nested candidates that git itself ignores (`git check-ignore`). Fail-open:
/// if the check cannot run, every candidate stays a root (old behavior).
async fn ignored_paths(
    repo: &std::path::Path,
    paths: &[std::path::PathBuf],
) -> std::collections::HashSet<String> {
    use std::collections::HashSet;
    if paths.is_empty() {
        return HashSet::new();
    }
    let repo = repo.to_string_lossy().to_string();
    let paths = paths.to_vec();
    let out = match tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.args(["-C", &repo, "check-ignore", "--"]);
        for p in &paths {
            cmd.arg(p);
        }
        cmd.output()
    })
    .await
    {
        Ok(Ok(out)) => out,
        _ => return HashSet::new(),
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

fn find_nested_git_dirs(
    base: &std::path::Path,
    dir: &std::path::Path,
    depth: usize,
    out: &mut Vec<std::path::PathBuf>,
) {
    if depth > MAX_NESTED_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if HEAVY_DIRS.contains(&name.as_ref()) || SKIPPED_DIRS.contains(&name.as_ref()) {
            continue;
        }
        if path != base && path.join(".git").exists() {
            // A nested repo's own nested repos would need their own `git.roots`
            // call; stop here rather than double-counting a submodule tree.
            out.push(path);
            continue;
        }
        find_nested_git_dirs(base, &path, depth + 1, out);
    }
}

async fn root_entry(base: &std::path::Path, path: &std::path::Path) -> wire::GitRoot {
    let repo = path.to_string_lossy().to_string();
    let name = if path == base {
        base.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| repo.clone())
    } else {
        path.strip_prefix(base)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| repo.clone())
    };
    wire::GitRoot {
        path: repo.clone(),
        name,
        branch: current_branch(&repo).await,
        remotes: remote_names(&repo).await,
    }
}

/// Configured remote names, deduped and in `git remote -v`'s order (fetch and
/// push lines for the same remote collapse to one entry).
async fn remote_names(repo: &str) -> Vec<String> {
    let Ok(out) = git(repo, &["remote", "-v"]).await else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let mut names: Vec<String> = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some(name) = line.split_whitespace().next() {
            if !names.iter().any(|n| n == name) {
                names.push(name.to_string());
            }
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    #[tokio::test]
    async fn git_roots_single_repo_with_two_remotes_has_no_extra_node() {
        let dir = std::env::temp_dir().join(format!("wf-roots-remotes-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        git(
            &dir,
            &["remote", "add", "origin", "https://example.com/a.git"],
        )
        .await;
        git(
            &dir,
            &["remote", "add", "upstream", "https://example.com/b.git"],
        )
        .await;

        let roots = git_roots(repo).await.unwrap();
        assert_eq!(roots.len(), 1, "two remotes must not create extra roots");
        let mut remotes = roots[0].remotes.clone();
        remotes.sort();
        assert_eq!(remotes, vec!["origin".to_string(), "upstream".to_string()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn git_roots_finds_nested_checkout() {
        let dir = std::env::temp_dir().join(format!("wf-roots-nested-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        let nested = dir.join("vendor").join("lib");
        init_repo(&nested).await;
        std::fs::write(nested.join("b.txt"), "two\n").unwrap();
        git(&nested, &["add", "."]).await;
        git(&nested, &["commit", "-q", "-m", "init"]).await;

        // macOS resolves `/tmp` to `/private/tmp`; git's `--show-toplevel`
        // canonicalizes, so compare against the canonical path too.
        let canonical_repo = std::fs::canonicalize(&dir).unwrap();
        let roots = git_roots(repo).await.unwrap();
        assert_eq!(roots.len(), 2, "primary root plus the nested checkout");
        assert!(roots
            .iter()
            .any(|r| std::path::Path::new(&r.path) == canonical_repo));
        assert!(roots.iter().any(|r| r.name == "vendor/lib"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn git_roots_empty_repo_still_returns_one_root() {
        let dir = std::env::temp_dir().join(format!("wf-roots-empty-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();

        let roots = git_roots(repo).await.unwrap();
        assert_eq!(roots.len(), 1);
        assert!(roots[0].remotes.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn git_roots_skips_nested_checkouts_under_ignored_paths() {
        // Study clones under an ignored folder must not force the multi-root
        // tree on an otherwise single-root project.
        let dir = std::env::temp_dir().join(format!("wf-roots-ignored-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;
        std::fs::write(dir.join(".gitignore"), "ref-projects/\n").unwrap();

        let nested = dir.join("ref-projects").join("clone");
        init_repo(&nested).await;

        let roots = git_roots(repo).await.unwrap();
        assert_eq!(roots.len(), 1, "ignored nested checkout is not a root");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn git_roots_skips_warpforge_task_worktrees() {
        // `.worktrees/` holds task checkouts, not working roots: a live task
        // must not flip an otherwise single-root project into multi-root.
        let dir = std::env::temp_dir().join(format!("wf-roots-wt-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        let nested = dir.join(".worktrees").join("t_abc");
        init_repo(&nested).await;

        let roots = git_roots(repo).await.unwrap();
        assert_eq!(roots.len(), 1, "task worktree is not a root");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn git_roots_empty_for_non_repo() {
        let dir = std::env::temp_dir().join(format!("wf-roots-none-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        assert!(git_roots(repo).await.unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }
}
