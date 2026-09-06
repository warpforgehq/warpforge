//! `git stash` surfaced in the Stash tab: list entries, preview their files
//! as diffs, apply/pop a whole entry, restore a single file out of one, or
//! drop it. Unlike the shelf (Warpforge-owned bundles outside the repo), the
//! stash is git-native and shared across every worktree of the repo — the UI
//! says so where it matters.

use anyhow::{bail, Result};
use tokio::process::Command;
use warpforge_protocol as wire;

use super::parse::parse_unified;
use super::working::untracked_diff;

fn check_id(id: &str) -> Result<()> {
    // `stash@{n}` only — never pass user text to git as a ref.
    if id.starts_with("stash@{") && id.ends_with('}') && id[7..id.len() - 1].parse::<u32>().is_ok()
    {
        return Ok(());
    }
    bail!("bad stash id: {id}");
}

fn check_paths(paths: &[String]) -> Result<()> {
    for p in paths {
        let p = p.trim();
        if p.is_empty() || p.contains("..") {
            bail!("refusing stash path: {p}");
        }
    }
    Ok(())
}

/// Stash `paths` (or everything when `None`) with `git stash push`. Plain
/// `push -- <untracked>` fails with "pathspec did not match", so `-u` rides
/// along exactly when the selection holds untracked files — git scopes it to
/// the pathspec, nothing outside is touched. Returns the created entry.
pub async fn stash_push(
    repo: &str,
    message: &str,
    paths: Option<&[String]>,
) -> Result<wire::StashEntry> {
    if let Some(sel) = paths {
        if sel.is_empty() {
            bail!("nothing to stash");
        }
        for p in sel {
            let p = p.trim();
            if p.is_empty() || p.contains("..") {
                bail!("refusing stash path: {p}");
            }
        }
    }
    let selected = |p: &str| match paths {
        None => true,
        Some(sel) => sel
            .iter()
            .any(|s| p == s || p.starts_with(&format!("{s}/"))),
    };
    let has_untracked = untracked_diff(repo)
        .await
        .map(|u| u.iter().any(|f| selected(&f.path)))
        .unwrap_or(false);

    let mut cmd = Command::new("git");
    cmd.args(["-C", repo, "stash", "push"]);
    if has_untracked {
        cmd.arg("-u");
    }
    if !message.trim().is_empty() {
        cmd.args(["-m", message.trim()]);
    }
    if let Some(sel) = paths {
        cmd.arg("--");
        for p in sel {
            cmd.arg(p.trim());
        }
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        bail!(
            "git stash push failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    if String::from_utf8_lossy(&out.stdout).contains("No local changes to save") {
        bail!("nothing to stash");
    }
    stash_list(repo)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("stash push reported success but left no entry"))
}

/// All stash entries, newest first (`stash@{0}` first, as git lists them).
/// The branch comes from git's own message prefix ("On main: …").
pub async fn stash_list(repo: &str) -> Result<Vec<wire::StashEntry>> {
    let out = Command::new("git")
        .args(["-C", repo, "stash", "list", "--format=%gd%x00%gs%x00%ct"])
        .output()
        .await?;
    if !out.status.success() {
        bail!(
            "git stash list failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut parts = line.split('\x00');
        let (Some(id), Some(subject), Some(ts)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let created_at = ts.trim().parse::<u64>().unwrap_or(0);
        // "On main: my message" / "WIP on main: abc1234 …" / custom -m text.
        let (branch, message) = match subject.strip_prefix("On ") {
            Some(rest) => match rest.split_once(':') {
                Some((b, m)) => (Some(b.trim().to_string()), m.trim().to_string()),
                None => (None, rest.trim().to_string()),
            },
            None => match subject.strip_prefix("WIP on ") {
                Some(rest) => match rest.split_once(':') {
                    Some((b, m)) => (Some(b.trim().to_string()), m.trim().to_string()),
                    None => (None, rest.trim().to_string()),
                },
                None => (None, subject.trim().to_string()),
            },
        };
        entries.push(wire::StashEntry {
            id: id.trim().to_string(),
            message,
            branch,
            created_at,
            files: stash_files(repo, id.trim()).await,
        });
    }
    Ok(entries)
}

/// File paths in one entry, for the list view. Never fails the whole listing
/// — worst case an entry shows no files until opened.
async fn stash_files(repo: &str, id: &str) -> Vec<String> {
    for extra in [true, false] {
        let mut cmd = Command::new("git");
        cmd.args(["-C", repo, "stash", "show", "--name-only", "--no-color"]);
        if extra {
            cmd.arg("--include-untracked");
        }
        cmd.arg(id);
        if let Ok(out) = cmd.output().await {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .collect();
            }
        }
    }
    Vec::new()
}

/// One entry with its files as diffs, for preview. Untracked stashes (`-u`)
/// need `--include-untracked`, otherwise git hides those files; older gits
/// without the flag fall back to the tracked-only view.
pub async fn stash_get(repo: &str, id: &str) -> Result<wire::StashDiff> {
    check_id(id)?;
    let entries = stash_list(repo).await?;
    let entry = entries
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("no such stash entry: {id}"))?;

    let mut files = Vec::new();
    for include_untracked in [true, false] {
        let mut cmd = Command::new("git");
        cmd.args([
            "-C",
            repo,
            "stash",
            "show",
            "-p",
            "--no-color",
            "--no-ext-diff",
        ]);
        if include_untracked {
            cmd.arg("--include-untracked");
        }
        let out = cmd.arg(id).output().await?;
        if out.status.success() {
            files = parse_unified(&String::from_utf8_lossy(&out.stdout));
            break;
        }
        if !include_untracked {
            bail!(
                "git stash show failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(wire::StashDiff { entry, files })
}

/// Apply (`pop=false`) or pop (`pop=true`) a whole entry. A conflicting pop
/// keeps the entry — that is git's own behavior, and the error names it.
pub async fn stash_apply(repo: &str, id: &str, pop: bool) -> Result<()> {
    check_id(id)?;
    let op = if pop { "pop" } else { "apply" };
    let out = Command::new("git")
        .args(["-C", repo, "stash", op, id])
        .output()
        .await?;
    if !out.status.success() {
        bail!(
            "git stash {op} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// Restore a single file out of a stash into the worktree ("unstash any
/// file"). The entry itself is untouched.
pub async fn stash_checkout_file(repo: &str, id: &str, paths: &[String]) -> Result<()> {
    check_id(id)?;
    check_paths(paths)?;
    if paths.is_empty() {
        bail!("nothing to restore");
    }
    let mut cmd = Command::new("git");
    cmd.args(["-C", repo, "checkout", id, "--"]);
    for p in paths {
        cmd.arg(p.trim());
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        bail!(
            "git checkout from stash failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// Drop an entry. The worktree is untouched.
pub async fn stash_drop(repo: &str, id: &str) -> Result<()> {
    check_id(id)?;
    let out = Command::new("git")
        .args(["-C", repo, "stash", "drop", id])
        .output()
        .await?;
    if !out.status.success() {
        bail!(
            "git stash drop failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    async fn fixture() -> (tempfile::TempDir, String) {
        let dir = tempfile::TempDir::new().unwrap();
        init_repo(dir.path()).await;
        let d = dir.path();
        std::fs::write(d.join("tracked.txt"), "one\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-q", "-m", "init"]).await;
        std::fs::write(d.join("tracked.txt"), "one\nmodified\n").unwrap();
        let r = d.to_str().unwrap().to_string();
        (dir, r)
    }

    #[tokio::test]
    async fn stash_round_trip_lists_previews_and_pops() {
        let (_dir, r) = fixture().await;
        git(
            std::path::Path::new(&r),
            &["stash", "push", "-q", "-m", "wip"],
        )
        .await;

        let list = stash_list(&r).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "stash@{0}");
        assert_eq!(list[0].message, "wip");

        let diff = stash_get(&r, "stash@{0}").await.unwrap();
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "tracked.txt");

        stash_apply(&r, "stash@{0}", true).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(std::path::Path::new(&r).join("tracked.txt")).unwrap(),
            "one\nmodified\n"
        );
        assert!(
            stash_list(&r).await.unwrap().is_empty(),
            "pop drops the entry"
        );
    }

    #[tokio::test]
    async fn stash_parses_branch_from_git_prefix() {
        let (_dir, r) = fixture().await;
        // No -m: git writes "WIP on <branch>: …" itself.
        git(std::path::Path::new(&r), &["stash", "push", "-q"]).await;

        let list = stash_list(&r).await.unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].branch.is_some(), "got: {:?}", list[0]);
    }

    #[tokio::test]
    async fn stash_checkout_file_restores_one_path_only() {
        let (_dir, r) = fixture().await;
        let d = std::path::Path::new(&r);
        std::fs::write(d.join("other.txt"), "one\n").unwrap();
        git(d, &["add", "."]).await;
        git(d, &["commit", "-q", "-m", "second"]).await;
        std::fs::write(d.join("tracked.txt"), "one\nA\n").unwrap();
        std::fs::write(d.join("other.txt"), "one\nB\n").unwrap();
        git(d, &["stash", "push", "-q", "-m", "wip"]).await;

        stash_checkout_file(&r, "stash@{0}", &["tracked.txt".to_string()])
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("tracked.txt")).unwrap(),
            "one\nA\n",
            "chosen file restored"
        );
        assert_eq!(
            std::fs::read_to_string(d.join("other.txt")).unwrap(),
            "one\n",
            "other file untouched"
        );
        assert_eq!(stash_list(&r).await.unwrap().len(), 1, "entry kept");
    }

    #[tokio::test]
    async fn stash_rejects_bad_ids_paths_and_missing_entries() {
        let (_dir, r) = fixture().await;
        assert!(stash_get(&r, "../evil").await.is_err());
        assert!(stash_apply(&r, "stash@{9}", false).await.is_err());
        assert!(stash_drop(&r, "stash@{9}").await.is_err());
        assert!(
            stash_checkout_file(&r, "stash@{0}", &["../evil".to_string()])
                .await
                .is_err()
        );
        assert!(stash_checkout_file(&r, "stash@{0}", &[]).await.is_err());
    }

    #[tokio::test]
    async fn stash_push_scopes_to_paths_and_returns_the_entry() {
        let (repo, r) = fixture().await;
        let d = repo.path();
        std::fs::write(d.join("other.txt"), "other\nmodified\n").unwrap();

        let entry = stash_push(&r, "wip", Some(&["tracked.txt".to_string()]))
            .await
            .unwrap();
        assert_eq!(entry.id, "stash@{0}");
        assert_eq!(entry.message, "wip");
        assert_eq!(
            std::fs::read_to_string(d.join("tracked.txt")).unwrap(),
            "one\n",
            "selected file stashed"
        );
        assert_eq!(
            std::fs::read_to_string(d.join("other.txt")).unwrap(),
            "other\nmodified\n",
            "unselected file stays"
        );
    }

    #[tokio::test]
    async fn stash_push_takes_untracked_selection_along() {
        // Plain `push -- new.txt` fails with "pathspec did not match" — the
        // `-u` flag must ride along exactly when untracked files are selected.
        let (repo, r) = fixture().await;
        let d = repo.path();
        std::fs::write(d.join("new.txt"), "brand new\n").unwrap();
        std::fs::write(d.join("spared.txt"), "spared\n").unwrap();

        stash_push(&r, "wip", Some(&["new.txt".to_string()]))
            .await
            .unwrap();
        assert!(!d.join("new.txt").exists(), "selected untracked stashed");
        assert!(d.join("spared.txt").exists(), "unselected untracked stays");
    }

    #[tokio::test]
    async fn stash_push_empty_selection_bails() {
        let (_dir, r) = fixture().await;
        assert!(stash_push(&r, "wip", Some(&["nope.txt".to_string()]))
            .await
            .is_err());
        assert!(stash_push(&r, "wip", Some(&[])).await.is_err());
    }
}
