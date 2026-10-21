//! Manager-free git operations, so the daemon can create, merge and remove
//! worktrees without awaiting git on the actor loop (ADR 0002). Callers record
//! the result with [`WorktreeManager::adopt`] or
//! [`WorktreeManager::forget`](super::WorktreeManager::forget).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::Worktree;

/// A detached worktree removal, boxed so the daemon can hold one as a field
/// and a test can swap in a slow remover (see `Daemon::spawn_worktree_removal`).
pub type RemoveFn = fn(
    PathBuf,
    PathBuf,
    String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>>;

/// The production remover the daemon uses: [`remove_detached`].
pub fn default_remover(
    base_repo: PathBuf,
    path: PathBuf,
    branch: String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>> {
    Box::pin(async move { remove_detached(&base_repo, &path, &branch).await })
}

/// Create a worktree without a manager, so the git work can run off the daemon
/// actor. The caller records the result with [`WorktreeManager::adopt`].
///
/// `git worktree add` takes long enough to be felt: run inside a command
/// handler it delayed every other task's messages and approvals until the new
/// task's checkout finished (ADR 0002).
pub async fn create_detached(
    base_repo: &Path,
    task_id: &str,
    base_branch: Option<&str>,
) -> Result<Worktree> {
    let base = match base_branch {
        Some(b) => b.to_string(),
        None => {
            let output = tokio::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(base_repo)
                .output()
                .await
                .context("failed to run git rev-parse")?;
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
    };
    fork_detached(base_repo, task_id, &base, &base).await
}

/// Fork a new `warpforge/task/<task_id>` branch from `start` into the task's
/// worktree, recording `target` as the branch it merges back into.
///
/// `--no-track` matters when `start` is a remote-tracking ref: git would
/// otherwise set it as the task branch's upstream, and a push would then aim
/// at the base branch itself.
pub(super) async fn fork_detached(
    base_repo: &Path,
    task_id: &str,
    start: &str,
    target: &str,
) -> Result<Worktree> {
    prepare_worktrees_dir(base_repo).await;
    let wt_dir = super::worktree_path(base_repo, task_id);
    let branch = format!("{}{task_id}", super::TASK_BRANCH_PREFIX);

    let status = tokio::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "--no-track",
            "-b",
            &branch,
            wt_dir.to_str().unwrap_or(".warpforge/worktrees/task"),
            start,
        ])
        .current_dir(base_repo)
        .status()
        .await
        .context("failed to run git worktree add")?;

    if !status.success() {
        anyhow::bail!("git worktree add failed (exit {status})");
    }

    Ok(Worktree {
        task_id: task_id.to_string(),
        path: wt_dir,
        branch,
        base_branch: target.to_string(),
    })
}

/// Keep the worktree folders out of git before a checkout lands in them.
/// Best-effort: a checkout with no worktree is worse than one whose folder is
/// briefly visible.
pub(super) async fn prepare_worktrees_dir(base_repo: &Path) {
    if let Err(e) = ensure_worktrees_gitignore(base_repo).await {
        eprintln!("[daemon] could not write .warpforge/worktrees/.gitignore: {e:#}");
    }
    // Legacy tasks may still have checkouts under `.worktrees/`; hide those
    // via info/exclude, but only when that directory actually exists.
    if base_repo.join(".worktrees").is_dir() {
        if let Err(e) = ensure_worktrees_excluded(base_repo).await {
            eprintln!("[daemon] could not add .worktrees/ to info/exclude: {e:#}");
        }
    }
}

/// Write `.warpforge/worktrees/.gitignore` (content `*`) so new task checkouts
/// never show as untracked in the user's checkout. Uses a `.gitignore` inside
/// the worktrees folder — never the user's root `.gitignore` or `.git`
/// (ADR 0015). Idempotent; the caller treats failure as best-effort.
async fn ensure_worktrees_gitignore(base_repo: &Path) -> Result<()> {
    let dir = base_repo.join(super::WORKTREES_REL);
    tokio::fs::create_dir_all(&dir)
        .await
        .with_context(|| format!("creating {}", dir.display()))?;
    let ignore = dir.join(".gitignore");
    const CONTENT: &str = "# Created by Warpforge automatically.\n*\n";
    match tokio::fs::read_to_string(&ignore).await {
        Ok(existing) if existing.lines().any(|l| l.trim() == "*") => return Ok(()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e).with_context(|| format!("reading {}", ignore.display())),
    }
    tokio::fs::write(&ignore, CONTENT)
        .await
        .with_context(|| format!("writing {}", ignore.display()))?;
    Ok(())
}

/// List `.worktrees/` in the repo's `info/exclude` for legacy checkouts. Uses
/// the per-clone exclude file, never the user's `.gitignore` (ADR 0015).
/// Idempotent; creates the file if missing.
async fn ensure_worktrees_excluded(base_repo: &Path) -> Result<()> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--git-path", "info/exclude"])
        .current_dir(base_repo)
        .output()
        .await
        .context("failed to run git rev-parse --git-path")?;
    if !output.status.success() {
        anyhow::bail!("git rev-parse --git-path failed (exit {})", output.status);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        anyhow::bail!("git rev-parse --git-path returned no path");
    }
    // `--git-path` prints a path relative to the cwd when the git dir is inside
    // it (the common case); it is absolute for a linked worktree's common dir.
    let exclude = if Path::new(&raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        base_repo.join(raw)
    };
    append_exclude_line(&exclude).await
}

/// Append `.worktrees/` to an exclude file if absent, creating it if missing.
async fn append_exclude_line(exclude: &Path) -> Result<()> {
    const LINE: &str = ".worktrees/";
    let existing = match tokio::fs::read_to_string(exclude).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(e).with_context(|| format!("reading {}", exclude.display()));
        }
    };
    if existing.lines().any(|l| l.trim() == LINE) {
        return Ok(());
    }
    if let Some(parent) = exclude.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(LINE);
    text.push('\n');
    tokio::fs::write(exclude, text)
        .await
        .with_context(|| format!("writing {}", exclude.display()))?;
    Ok(())
}

/// [`create_detached`] for a conversation branch: branch from `base_branch`
/// (the current HEAD when `None`) and carry over the uncommitted changes in
/// `source_path`.
///
/// `source_path` is wherever the source task actually works, which is its own
/// worktree only when it has one — a task running in the project checkout
/// branches from there. Getting this wrong is silent: the branch comes up on a
/// clean HEAD and the work it was meant to continue is simply absent.
pub async fn create_branched_detached(
    base_repo: &Path,
    task_id: &str,
    base_branch: Option<&str>,
    source_path: &Path,
) -> Result<Worktree> {
    let wt = create_detached(base_repo, task_id, base_branch).await?;
    copy_working_state(source_path, &wt.path)
        .await
        .with_context(|| {
            format!("failed to copy working state into branched worktree {task_id}")
        })?;
    Ok(wt)
}

/// Remove a worktree and delete its branch, without a manager. The caller drops
/// it from the map with [`WorktreeManager::forget`](super::WorktreeManager::forget).
/// A branch the task checked out rather than created is kept (see
/// [`super::owns_branch`]).
pub async fn remove_detached(base_repo: &Path, path: &Path, branch: &str) -> Result<()> {
    crate::daemon::explorer::registry().forget(path);
    let status = tokio::process::Command::new("git")
        .args(["worktree", "remove", "--force", path.to_str().unwrap_or("")])
        .current_dir(base_repo)
        .status()
        .await
        .context("failed to run git worktree remove")?;
    if !status.success() {
        anyhow::bail!("git worktree remove failed (exit {status})");
    }
    if !super::owns_branch(branch) {
        return Ok(());
    }
    let _ = tokio::process::Command::new("git")
        .args(["branch", "-D", branch])
        .current_dir(base_repo)
        .status()
        .await;
    Ok(())
}

/// Copy the uncommitted working-tree state of `source` into `target` so a
/// branched worktree starts from the exact files the source left behind.
/// Handles tracked modifications/deletions (via a binary diff applied with
/// `git apply`) and new untracked files (copied directly).
pub(super) async fn copy_working_state(source: &Path, target: &Path) -> Result<()> {
    use tokio::io::AsyncWriteExt;

    // 1) Apply tracked changes (modified + deleted) from the source HEAD.
    let diff = tokio::process::Command::new("git")
        .args(["diff", "--binary", "HEAD"])
        .current_dir(source)
        .output()
        .await
        .context("failed to run git diff in source worktree")?;
    if !diff.status.success() {
        anyhow::bail!("git diff failed in source worktree");
    }
    if !diff.stdout.is_empty() {
        let mut apply = tokio::process::Command::new("git")
            .args(["apply", "-"])
            .current_dir(target)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("failed to spawn git apply")?;
        apply
            .stdin
            .take()
            .expect("git apply stdin should be piped")
            .write_all(&diff.stdout)
            .await
            .context("failed to write diff into git apply")?;
        let out = apply
            .wait_with_output()
            .await
            .context("git apply did not finish")?;
        if !out.status.success() {
            anyhow::bail!("git apply failed: {}", String::from_utf8_lossy(&out.stderr));
        }
    }

    // 2) Copy new (untracked) files, preserving directory structure.
    let untracked = tokio::process::Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(source)
        .output()
        .await
        .context("failed to list untracked files")?;
    if !untracked.status.success() {
        anyhow::bail!("git ls-files failed in source worktree");
    }
    for line in String::from_utf8_lossy(&untracked.stdout).lines() {
        if line.is_empty() {
            continue;
        }
        let src = source.join(line);
        // `git ls-files --others` reports a nested checkout as one directory
        // entry rather than its contents, and every worktree lives inside the
        // project under `.warpforge/worktrees/<task>` (or the legacy
        // `.worktrees/<task>`). So when the source is the project checkout
        // itself, its own worktrees show up here — copying one would fail
        // outright, and copying it successfully would be worse. Nothing that is
        // not a plain file belongs in a branch's starting state.
        if !src.is_file() {
            continue;
        }
        let dst = target.join(line);
        if let Some(parent) = dst.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        tokio::fs::copy(&src, &dst)
            .await
            .with_context(|| format!("copying {}", line))?;
    }

    Ok(())
}
