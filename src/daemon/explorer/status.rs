//! `git.status` for the Explorer's change markers, coalesced per root: at most
//! one run in flight, and every request made during a run gets a later one.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use warpforge_protocol as wire;

use crate::daemon::diff::is_ignored_path;

pub(crate) const STATUS_CAP: usize = 10_000;

#[derive(Default)]
pub(crate) struct StatusRuns {
    roots: Mutex<HashMap<String, Arc<RootRuns>>>,
}

#[derive(Default)]
struct RootRuns {
    requested: AtomicU64,
    /// The latest result and the request number it covers. Held across a run,
    /// so it is also what keeps runs for one root serial.
    last: tokio::sync::Mutex<Option<(u64, Arc<wire::GitStatus>)>>,
}

impl StatusRuns {
    /// Status of the checkout at `root`, from a run that started after this
    /// call did.
    pub(crate) async fn status(&self, root: &str) -> Result<Arc<wire::GitStatus>> {
        let root = std::fs::canonicalize(root)?.to_string_lossy().into_owned();
        let run_root = root.clone();
        self.coalesced(&root, move || git_status(run_root)).await
    }

    async fn coalesced<F, Fut>(&self, root: &str, run: F) -> Result<Arc<wire::GitStatus>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<wire::GitStatus>>,
    {
        let runs = self
            .roots
            .lock()
            .unwrap()
            .entry(root.to_string())
            .or_default()
            .clone();
        let wanted = runs.requested.fetch_add(1, Ordering::SeqCst) + 1;
        let mut last = runs.last.lock().await;
        if let Some((covered, status)) = last.as_ref() {
            if *covered >= wanted {
                return Ok(status.clone());
            }
        }
        let covers = runs.requested.load(Ordering::SeqCst);
        let status = Arc::new(run().await?);
        *last = Some((covers, status.clone()));
        Ok(status)
    }
}

async fn git_status(root: String) -> Result<wire::GitStatus> {
    let out = tokio::process::Command::new("git")
        .args(["--no-optional-locks", "-C", &root, "status"])
        .args([
            "--porcelain=v1",
            "--untracked-files=all",
            "--no-renames",
            "-z",
        ])
        .output()
        .await?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(parse(&out.stdout, STATUS_CAP))
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
                    Ok(wire::GitStatus {
                        entries: vec![wire::StatusEntry {
                            path: n.to_string(),
                            code: "??".into(),
                        }],
                        truncated: false,
                    })
                })
                .await
                .unwrap()
            }));
        }
        futures::future::join_all(joins).await;
        assert!(count.load(Ordering::SeqCst) <= 2, "{count:?}");

        let later = runs
            .coalesced("/r", || async {
                Ok(wire::GitStatus {
                    entries: vec![],
                    truncated: false,
                })
            })
            .await
            .unwrap();
        assert!(
            later.entries.is_empty(),
            "a request after the burst runs again"
        );
    }
}
