//! VCS shelf ("Shelve Silently" / "Shelve…"): named bundles of uncommitted
//! changes, stored OUTSIDE the repo under `~/.warpforge/shelf/<repo-slug>/`.
//! Inside the worktree is not an option — `.warpforge/` is not gitignored, so
//! shelf patches would show up as untracked files themselves.
//!
//! Layout per entry `<root>/<id>/`: `meta.json`, `tracked.patch` (raw
//! `git diff HEAD` of the shelved tracked paths), and `untracked/` mirroring
//! the shelved untracked files. Shelving reverts the worktree (tracked via
//! reset+checkout, untracked by deleting the originals); unshelving
//! `git apply`s the patch back and restores the untracked files.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use tokio::process::Command;
use warpforge_protocol as wire;

use super::parse::parse_unified;
use super::working::{current_branch, tracked_diff, untracked_diff};

/// `git diff HEAD -- <paths>` as raw text, for shelf storage.
async fn raw_tracked_patch(repo: &str, paths: &[String]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        repo,
        "diff",
        "HEAD",
        "--no-color",
        "--no-ext-diff",
        "--",
    ]);
    for p in paths {
        cmd.arg(p);
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        bail!(
            "git diff failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn check_paths(paths: &[String]) -> Result<()> {
    for p in paths {
        let p = p.trim();
        if p.is_empty() || p.contains("..") {
            bail!("refusing shelved path: {p}");
        }
    }
    Ok(())
}

/// Which of these paths exist in HEAD. Drives the shelve revert: only HEAD
/// members can be `git checkout`-restored, the rest are worktree-only copies.
/// An unborn HEAD (no commits yet) simply contains nothing — that is an empty
/// set, not an error.
async fn ls_tree_head(repo: &str, paths: &[String]) -> Result<std::collections::HashSet<String>> {
    let mut cmd = Command::new("git");
    cmd.args(["-C", repo, "ls-tree", "HEAD", "--name-only", "-z", "--"]);
    for p in paths {
        cmd.arg(p);
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        return Ok(std::collections::HashSet::new());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\x00')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

/// Filesystem-safe per-repo directory name: the full path with every
/// non-alphanumeric char flattened. Long but collision-free across checkouts.
fn slug(repo: &str) -> String {
    repo.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

fn shelf_root(home: &Path, repo: &str) -> PathBuf {
    home.join(".warpforge").join("shelf").join(slug(repo))
}

fn entry_dir(home: &Path, repo: &str, id: &str) -> PathBuf {
    shelf_root(home, repo).join(id)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

fn read_meta(dir: &Path) -> Result<wire::ShelfEntry> {
    let text = std::fs::read_to_string(dir.join("meta.json"))?;
    Ok(serde_json::from_str(&text)?)
}

/// All shelf entries for a repo, newest first. Broken entries are skipped —
/// one corrupt bundle must not hide the rest.
pub async fn shelf_list(home: &Path, repo: &str) -> Vec<wire::ShelfEntry> {
    let root = shelf_root(home, repo);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&root) else {
        return out;
    };
    for entry in rd.flatten() {
        if let Ok(meta) = read_meta(&entry.path()) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
    out
}

/// Shelve `paths` (or every change when `None`): store the bundle and revert
/// the worktree, so the changes leave Changes/Unversioned. An empty `name`
/// becomes `<branch> (N files)`.
pub async fn shelf_create(
    home: &Path,
    repo: &str,
    name: &str,
    paths: Option<&[String]>,
) -> Result<wire::ShelfEntry> {
    if let Some(sel) = paths {
        check_paths(sel)?;
    }
    let tracked = tracked_diff(repo).await.unwrap_or_default();
    let untracked = untracked_diff(repo)
        .await
        .map_err(|_| anyhow::anyhow!("could not scan the working tree"))?;

    // A selected folder shelves everything under it.
    let selected = |p: &str| match paths {
        None => true,
        Some(sel) => sel
            .iter()
            .any(|s| p == s || p.starts_with(&format!("{s}/"))),
    };
    let tracked_paths: Vec<String> = tracked
        .iter()
        .map(|f| f.path.clone())
        .filter(|p| selected(p))
        .collect();
    let untracked_paths: Vec<String> = untracked
        .iter()
        .map(|f| f.path.clone())
        .filter(|p| selected(p))
        .collect();
    if tracked_paths.is_empty() && untracked_paths.is_empty() {
        bail!("nothing to shelve");
    }

    let patch = if tracked_paths.is_empty() {
        String::new()
    } else {
        raw_tracked_patch(repo, &tracked_paths).await?
    };

    let id = new_id();
    let dir = entry_dir(home, repo, &id);
    let created_at = crate::daemon::task::now_secs();
    let branch = current_branch(repo).await;
    let mut files = tracked_paths.clone();
    files.extend(untracked_paths.clone());
    files.sort();
    let entry = wire::ShelfEntry {
        id: id.clone(),
        name: if name.trim().is_empty() {
            format!(
                "{} ({} file{})",
                branch.as_deref().unwrap_or("changes"),
                files.len(),
                if files.len() == 1 { "" } else { "s" }
            )
        } else {
            name.trim().to_string()
        },
        created_at,
        branch,
        files,
    };

    // Store first, revert second: if the revert fails halfway, the bundle
    // still holds everything and nothing is lost.
    std::fs::create_dir_all(dir.join("untracked"))?;
    for p in &untracked_paths {
        let src = Path::new(repo).join(p);
        let dst = dir.join("untracked").join(p);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&src, &dst)?;
    }
    std::fs::write(dir.join("tracked.patch"), &patch)?;
    std::fs::write(dir.join("meta.json"), serde_json::to_string_pretty(&entry)?)?;

    // Revert the worktree. Reset first: files staged via "Add to VCS" live in
    // the index, and plain checkout would leave them staged. Then restore from
    // HEAD only what HEAD actually has: staged-new files and rename targets
    // are NOT in HEAD (`git checkout HEAD -- new.txt` fails with "pathspec
    // did not match") — their worktree copies are deleted instead, and
    // rename sources are restored from their old paths.
    if !tracked_paths.is_empty() {
        let mut candidates = tracked_paths.clone();
        for f in &tracked {
            if let Some(old) = f.old_path.as_deref() {
                if tracked_paths.contains(&f.path) && !candidates.contains(&old.to_string()) {
                    candidates.push(old.to_string());
                }
            }
        }
        let in_head = ls_tree_head(repo, &candidates).await?;
        for chunk in tracked_paths.chunks(100) {
            let mut reset = Command::new("git");
            reset.args(["-C", repo, "reset", "-q", "HEAD", "--"]);
            for p in chunk {
                reset.arg(p);
            }
            let out = reset.output().await?;
            if !out.status.success() {
                bail!("could not shelve cleanly: git reset failed, the bundle is kept");
            }
        }
        let restorable: Vec<&String> = candidates.iter().filter(|p| in_head.contains(*p)).collect();
        for chunk in restorable.chunks(100) {
            let mut co = Command::new("git");
            co.args(["-C", repo, "checkout", "-q", "HEAD", "--"]);
            for p in chunk {
                co.arg(p);
            }
            let out = co.output().await?;
            if !out.status.success() {
                bail!("could not shelve cleanly: git checkout failed, the bundle is kept");
            }
        }
        for p in &tracked_paths {
            if !in_head.contains(p) {
                std::fs::remove_file(Path::new(repo).join(p)).ok();
            }
        }
    }
    for p in &untracked_paths {
        std::fs::remove_file(Path::new(repo).join(p))?;
    }
    Ok(entry)
}

/// A shelf entry with its files as diffs, for preview before unshelving.
pub async fn shelf_get(home: &Path, repo: &str, id: &str) -> Result<wire::ShelfDiff> {
    if id.contains('/') || id.contains("..") {
        bail!("bad shelf id: {id}");
    }
    let dir = entry_dir(home, repo, id);
    let entry = read_meta(&dir).map_err(|_| anyhow::anyhow!("no such shelf entry: {id}"))?;
    let patch = std::fs::read_to_string(dir.join("tracked.patch")).unwrap_or_default();
    let mut files = parse_unified(&patch);
    let mut rest: Vec<(String, String)> = Vec::new();
    collect_untracked(&dir.join("untracked"), &dir.join("untracked"), &mut rest)?;
    for (path, content) in rest {
        files.push(super::working::added_file_diff(&path, &content));
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(wire::ShelfDiff { entry, files })
}

fn collect_untracked(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) -> Result<()> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_untracked(base, &p, out)?;
        } else if let Ok(rel) = p.strip_prefix(base) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            let content = std::fs::read_to_string(&p).unwrap_or_default();
            out.push((rel, content));
        }
    }
    Ok(())
}

/// Unshelve: `git apply` the tracked patch back, restore untracked files.
/// Pre-checks everything first — a conflict bails with the worktree and the
/// bundle both untouched. `drop` removes the bundle afterwards.
pub async fn shelf_apply(home: &Path, repo: &str, id: &str, drop: bool) -> Result<()> {
    if id.contains('/') || id.contains("..") {
        bail!("bad shelf id: {id}");
    }
    let dir = entry_dir(home, repo, id);
    if !dir.join("meta.json").exists() {
        bail!("no such shelf entry: {id}");
    }

    // Untracked targets must not exist — restoring over them would silently
    // clobber whatever is there now.
    let mut rest: Vec<String> = Vec::new();
    collect_paths(&dir.join("untracked"), &dir.join("untracked"), &mut rest)?;
    for p in &rest {
        if Path::new(repo).join(p).exists() {
            bail!("cannot unshelve: {p} already exists in the working tree");
        }
    }

    let patch = std::fs::read_to_string(dir.join("tracked.patch")).unwrap_or_default();
    if !patch.trim().is_empty() {
        // --check first: a conflict bails with the tree and the bundle both
        // untouched, before anything is written.
        let child = Command::new("git")
            .args(["-C", repo, "apply", "--check", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let child = write_stdin(child, patch.as_bytes()).await?;
        let out = child.wait_with_output().await?;
        if !out.status.success() {
            bail!(
                "cannot unshelve cleanly: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        apply_patch(repo, &patch).await?;
    }
    for p in &rest {
        let src = dir.join("untracked").join(p);
        let dst = Path::new(repo).join(p);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&src, &dst)?;
    }
    if drop {
        std::fs::remove_dir_all(&dir).ok();
    }
    Ok(())
}

async fn write_stdin(
    mut child: tokio::process::Child,
    data: &[u8],
) -> Result<tokio::process::Child> {
    use tokio::io::AsyncWriteExt;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(data).await?;
        stdin.flush().await?;
        drop(stdin);
    }
    Ok(child)
}

async fn apply_patch(repo: &str, patch: &str) -> Result<()> {
    let child = Command::new("git")
        .args(["-C", repo, "apply", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let child = write_stdin(child, patch.as_bytes()).await?;
    let out = child.wait_with_output().await?;
    if !out.status.success() {
        bail!(
            "git apply failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

fn collect_paths(base: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_paths(base, &p, out)?;
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

/// Delete a shelf bundle. The worktree is untouched.
pub async fn shelf_drop(home: &Path, repo: &str, id: &str) -> Result<()> {
    if id.contains('/') || id.contains("..") {
        bail!("bad shelf id: {id}");
    }
    let dir = entry_dir(home, repo, id);
    if !dir.join("meta.json").exists() {
        bail!("no such shelf entry: {id}");
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    async fn fixture() -> (tempfile::TempDir, tempfile::TempDir, String) {
        let repo = tempfile::TempDir::new().unwrap();
        let home = tempfile::TempDir::new().unwrap();
        init_repo(repo.path()).await;
        let dir = repo.path();
        std::fs::write(dir.join("tracked.txt"), "one\n").unwrap();
        git(dir, &["add", "."]).await;
        git(dir, &["commit", "-q", "-m", "init"]).await;
        std::fs::write(dir.join("tracked.txt"), "one\nmodified\n").unwrap();
        std::fs::write(dir.join("new.txt"), "brand new\n").unwrap();
        let r = dir.to_str().unwrap().to_string();
        (repo, home, r)
    }

    #[tokio::test]
    async fn shelve_round_trip_restores_everything() {
        let (repo, home, r) = fixture().await;
        let hp = home.path();

        let entry = shelf_create(hp, &r, "wip", None).await.unwrap();
        assert_eq!(
            entry.files,
            vec!["new.txt".to_string(), "tracked.txt".to_string()]
        );
        // Worktree is clean now.
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).unwrap(),
            "one\n"
        );
        assert!(!repo.path().join("new.txt").exists());

        let list = shelf_list(hp, &r).await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "wip");

        let diff = shelf_get(hp, &r, &entry.id).await.unwrap();
        assert_eq!(diff.files.len(), 2);

        shelf_apply(hp, &r, &entry.id, true).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).unwrap(),
            "one\nmodified\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("new.txt")).unwrap(),
            "brand new\n"
        );
        assert!(
            shelf_list(hp, &r).await.is_empty(),
            "drop=true removes the bundle"
        );
    }

    #[tokio::test]
    async fn shelve_selection_leaves_the_rest() {
        let (repo, home, r) = fixture().await;
        let hp = home.path();

        shelf_create(hp, &r, "part", Some(&["new.txt".to_string()]))
            .await
            .unwrap();
        assert!(
            !repo.path().join("new.txt").exists(),
            "shelved file reverted"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).unwrap(),
            "one\nmodified\n",
            "unselected change stays"
        );
    }

    #[tokio::test]
    async fn shelve_staged_new_file_reverts_and_restores() {
        // The reported bug: "Add to VCS" stages a new file (in the index, not
        // in HEAD), and shelving it died at `git checkout HEAD -- new.txt`
        // with "pathspec did not match".
        let (repo, home, r) = fixture().await;
        let hp = home.path();
        let d = repo.path();
        std::fs::write(d.join("staged.txt"), "staged new\n").unwrap();
        git(d, &["add", "staged.txt"]).await;

        let entry = shelf_create(hp, &r, "staged", Some(&["staged.txt".to_string()]))
            .await
            .unwrap();
        assert!(!d.join("staged.txt").exists(), "worktree copy reverted");
        assert!(
            shelf_list(hp, &r).await.iter().any(|e| e.id == entry.id),
            "bundle kept"
        );

        shelf_apply(hp, &r, &entry.id, true).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("staged.txt")).unwrap(),
            "staged new\n"
        );
    }

    #[tokio::test]
    async fn shelve_rename_round_trip() {
        let (repo, home, r) = fixture().await;
        let hp = home.path();
        let d = repo.path();
        git(d, &["mv", "tracked.txt", "renamed.txt"]).await;

        let entry = shelf_create(hp, &r, "mv", None).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("tracked.txt")).unwrap(),
            "one\n",
            "rename source restored"
        );
        assert!(!d.join("renamed.txt").exists(), "rename target reverted");

        shelf_apply(hp, &r, &entry.id, true).await.unwrap();
        assert!(!d.join("tracked.txt").exists(), "rename re-applied");
        assert_eq!(
            std::fs::read_to_string(d.join("renamed.txt")).unwrap(),
            "one\nmodified\n"
        );
    }

    #[tokio::test]
    async fn shelve_empty_selection_bails() {
        let (_repo, home, r) = fixture().await;
        assert!(
            shelf_create(home.path(), &r, "x", Some(&["nope.txt".to_string()]))
                .await
                .is_err()
        );
        assert!(shelf_create(home.path(), &r, "", Some(&[])).await.is_err());
    }

    #[tokio::test]
    async fn unshelve_conflict_keeps_both_sides() {
        let (repo, home, r) = fixture().await;
        let hp = home.path();
        let entry = shelf_create(hp, &r, "wip", None).await.unwrap();

        // Conflicting edit lands after shelving.
        std::fs::write(repo.path().join("tracked.txt"), "one\nCONFLICT\n").unwrap();
        assert!(shelf_apply(hp, &r, &entry.id, true).await.is_err());
        // Bundle kept, worktree edit kept.
        assert_eq!(shelf_list(hp, &r).await.len(), 1);
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).unwrap(),
            "one\nCONFLICT\n"
        );
    }

    #[tokio::test]
    async fn unshelve_refuses_to_clobber_untracked() {
        let (repo, home, r) = fixture().await;
        let hp = home.path();
        let entry = shelf_create(hp, &r, "wip", None).await.unwrap();

        std::fs::write(repo.path().join("new.txt"), "someone else\n").unwrap();
        let err = shelf_apply(hp, &r, &entry.id, false).await.unwrap_err();
        assert!(err.to_string().contains("already exists"), "got: {err}");
    }

    #[tokio::test]
    async fn drop_missing_entry_bails() {
        let (_repo, home, r) = fixture().await;
        assert!(shelf_drop(home.path(), &r, "deadbeefcafe").await.is_err());
        assert!(shelf_apply(home.path(), &r, "../evil", false)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn empty_name_falls_back_to_branch_and_count() {
        let (_repo, home, r) = fixture().await;
        let entry = shelf_create(home.path(), &r, "   ", None).await.unwrap();
        assert!(entry.name.contains("2 files"), "got: {}", entry.name);
    }
}
