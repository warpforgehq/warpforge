//! Git's view of a checkout for the Explorer — change markers and the tracked
//! files an ignore pattern matches — coalesced per root: at most one run in
//! flight, and every request made during a run gets a later one.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use warpforge_protocol as wire;

use crate::daemon::diff::is_ignored_path;

pub(crate) const STATUS_CAP: usize = 10_000;
pub(crate) const TRACKED_IGNORED_CAP: usize = 10_000;

/// Tracked files matched by an ignore pattern, plus their ancestor
/// directories. Git does not treat these as ignored, so neither does the tree.
pub(crate) type TrackedIgnored = HashSet<String>;

#[derive(Default)]
struct Snapshot {
    status: Arc<wire::GitStatus>,
    tracked_ignored: Arc<TrackedIgnored>,
}

#[derive(Default)]
pub(crate) struct StatusRuns {
    roots: Mutex<HashMap<String, Arc<RootRuns>>>,
}

#[derive(Default)]
struct RootRuns {
    requested: AtomicU64,
    /// The latest result and the request number it covers. Held across a run,
    /// so it is also what keeps runs for one root serial.
    last: tokio::sync::Mutex<Option<(u64, Arc<Snapshot>)>>,
}

impl StatusRuns {
    /// Status of the checkout at `root`, from a run that started after this
    /// call did.
    pub(crate) async fn status(&self, root: &str) -> Result<Arc<wire::GitStatus>> {
        let root = std::fs::canonicalize(root)?.to_string_lossy().into_owned();
        let run_root = root.clone();
        let snapshot = self.coalesced(&root, move || snapshot(run_root)).await?;
        Ok(snapshot.status.clone())
    }

    /// The tracked-but-ignored set from the latest run, running one only when
    /// this root has none yet. It refreshes whenever `status` runs.
    pub(crate) async fn tracked_ignored(&self, root: &str) -> Result<Arc<TrackedIgnored>> {
        let root = std::fs::canonicalize(root)?.to_string_lossy().into_owned();
        if let Some((_, snapshot)) = self.runs(&root).last.lock().await.as_ref() {
            return Ok(snapshot.tracked_ignored.clone());
        }
        let run_root = root.clone();
        let snapshot = self.coalesced(&root, move || snapshot(run_root)).await?;
        Ok(snapshot.tracked_ignored.clone())
    }

    fn runs(&self, root: &str) -> Arc<RootRuns> {
        self.roots
            .lock()
            .unwrap()
            .entry(root.to_string())
            .or_default()
            .clone()
    }

    async fn coalesced<F, Fut>(&self, root: &str, run: F) -> Result<Arc<Snapshot>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Snapshot>>,
    {
        let runs = self.runs(root);
        let wanted = runs.requested.fetch_add(1, Ordering::SeqCst) + 1;
        let mut last = runs.last.lock().await;
        if let Some((covered, snapshot)) = last.as_ref() {
            if *covered >= wanted {
                return Ok(snapshot.clone());
            }
        }
        let covers = runs.requested.load(Ordering::SeqCst);
        let snapshot = Arc::new(run().await?);
        *last = Some((covers, snapshot.clone()));
        Ok(snapshot)
    }
}

async fn snapshot(root: String) -> Result<Snapshot> {
    let (status, tracked_ignored) = tokio::join!(git_status(&root), tracked_ignored(&root));
    Ok(Snapshot {
        status: Arc::new(status?),
        tracked_ignored: Arc::new(tracked_ignored.unwrap_or_default()),
    })
}

async fn tracked_ignored(root: &str) -> Result<TrackedIgnored> {
    let out = tokio::process::Command::new("git")
        .args([
            "--no-optional-locks",
            "-C",
            root,
            "ls-files",
            "-z",
            "--cached",
        ])
        .arg("--ignored")
        .arg("--exclude-standard")
        .output()
        .await?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let mut set = TrackedIgnored::new();
    for path in out
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .take(TRACKED_IGNORED_CAP)
    {
        let path = String::from_utf8_lossy(path);
        let mut at = path.as_ref();
        set.insert(at.to_string());
        while let Some((parent, _)) = at.rsplit_once('/') {
            if !set.insert(parent.to_string()) {
                break;
            }
            at = parent;
        }
    }
    Ok(set)
}

async fn git_status(root: &str) -> Result<wire::GitStatus> {
    let out = tokio::process::Command::new("git")
        .args(["--no-optional-locks", "-C", root, "status"])
        .args([
            "--porcelain=v1",
            "--untracked-files=all",
            "--no-renames",
            "-z",
        ])
        .output()
        .await?;
    if !out.status.success() {
        if !is_git_checkout(root).await {
            return Ok(wire::GitStatus::default());
        }
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(parse(&out.stdout, STATUS_CAP))
}

/// Asked only after a failure, so a non-git project costs one extra spawn
/// and git's localized error text is never parsed.
async fn is_git_checkout(root: &str) -> bool {
    tokio::process::Command::new("git")
        .args(["--no-optional-locks", "-C", root, "rev-parse", "--git-dir"])
        .output()
        .await
        .is_ok_and(|out| out.status.success())
}

fn parse(stdout: &[u8], cap: usize) -> wire::GitStatus {
    let mut entries = Vec::new();
    let mut truncated = false;
    for record in stdout.split(|b| *b == 0) {
        if record.len() < 4 {
            continue;
        }
        let code = String::from_utf8_lossy(&record[..2]).into_owned();
        let path = String::from_utf8_lossy(&record[3..]);
        let path = path.trim_end_matches('/');
        if is_ignored_path(path) {
            continue;
        }
        if entries.len() == cap {
            truncated = true;
            break;
        }
        entries.push(wire::StatusEntry {
            path: path.to_string(),
            code,
        });
    }
    wire::GitStatus { entries, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::diff::testsupport::{git, init_repo};
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    fn codes(status: &wire::GitStatus) -> Vec<(&str, &str)> {
        status
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.code.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn reports_changes_and_drops_hidden_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        std::fs::write(root.join("kept.rs"), "a").unwrap();
        std::fs::write(root.join("gone.rs"), "a").unwrap();
        git(root, &["add", "."]).await;
        git(root, &["commit", "-qm", "init"]).await;
        std::fs::write(root.join("kept.rs"), "b").unwrap();
        std::fs::remove_file(root.join("gone.rs")).unwrap();
        std::fs::create_dir_all(root.join("new dir")).unwrap();
        std::fs::write(root.join("new dir/a b.rs"), "a").unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("node_modules/x/i.js"), "a").unwrap();

        let status = StatusRuns::default()
            .status(root.to_str().unwrap())
            .await
            .unwrap();
        let mut found = codes(&status);
        found.sort();
        assert_eq!(
            found,
            [
                ("gone.rs", " D"),
                ("kept.rs", " M"),
                ("new dir/a b.rs", "??")
            ]
        );
        assert!(!status.truncated);
    }

    #[tokio::test]
    async fn a_non_git_project_has_no_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "a").unwrap();
        let status = StatusRuns::default()
            .status(dir.path().to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(*status, wire::GitStatus::default());
    }

    #[tokio::test]
    async fn tracked_ignored_lists_files_and_their_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        std::fs::create_dir_all(root.join("public/js")).unwrap();
        std::fs::write(root.join("public/js/sw.js"), "a").unwrap();
        git(root, &["add", "."]).await;
        git(root, &["commit", "-qm", "init"]).await;
        std::fs::write(root.join(".gitignore"), "sw.js\n").unwrap();

        let runs = StatusRuns::default();
        let root = root.to_str().unwrap();
        let mut found: Vec<_> = runs
            .tracked_ignored(root)
            .await
            .unwrap()
            .iter()
            .cloned()
            .collect();
        found.sort();
        assert_eq!(found, ["public", "public/js", "public/js/sw.js"]);
    }

    #[test]
    fn parse_caps_and_flags_truncation() {
        let status = parse(b"?? a\0?? b\0?? c\0", 2);
        assert_eq!(codes(&status), [("a", "??"), ("b", "??")]);
        assert!(status.truncated);
    }

    #[tokio::test]
    async fn a_burst_runs_at_most_twice_and_the_last_request_is_covered() {
        let runs = Arc::new(StatusRuns::default());
        let count = Arc::new(AtomicUsize::new(0));
        let mut joins = Vec::new();
        for _ in 0..10 {
            let runs = runs.clone();
            let count = count.clone();
            joins.push(tokio::spawn(async move {
                runs.coalesced("/r", move || async move {
                    let n = count.fetch_add(1, Ordering::SeqCst) + 1;
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok(Snapshot {
                        status: Arc::new(wire::GitStatus {
                            entries: vec![wire::StatusEntry {
                                path: n.to_string(),
                                code: "??".into(),
                            }],
                            truncated: false,
                        }),
                        ..Default::default()
                    })
                })
                .await
                .unwrap()
            }));
        }
        futures::future::join_all(joins).await;
        assert!(count.load(Ordering::SeqCst) <= 2, "{count:?}");

        let later = runs
            .coalesced("/r", || async { Ok(Snapshot::default()) })
            .await
            .unwrap();
        assert!(
            later.status.entries.is_empty(),
            "a request after the burst runs again"
        );
    }
}
