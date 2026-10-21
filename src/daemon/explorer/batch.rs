//! Turns one root's raw watcher events into `fs.changed` batches: which listed
//! folders changed, whether git's view did, and whether the client should
//! simply reload everything.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind};
use tokio::sync::mpsc;

use super::{Class, SharedStack};

/// Quiet time that ends a batch.
pub(crate) const SETTLE: Duration = Duration::from_millis(100);
/// Longest a batch waits under a steady stream of events.
pub(crate) const MAX_WAIT: Duration = Duration::from_secs(1);

/// Files in the git dir whose change can move `git status`.
const GIT_STATE: &[&str] = &["index", "HEAD", "packed-refs", "ORIG_HEAD", "MERGE_HEAD"];

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Batch {
    /// Folders, relative to the root ("" is the root), whose entries changed.
    pub(crate) dirs: BTreeSet<String>,
    /// A visible path was created, removed or renamed.
    pub(crate) index_changed: bool,
    /// Something that can move `git status` changed without a listing changing.
    pub(crate) git_changed: bool,
    /// Events were lost or the ignore rules changed; every listing is suspect.
    pub(crate) rescan: bool,
}

impl Batch {
    pub(crate) fn is_empty(&self) -> bool {
        self.dirs.is_empty() && !self.index_changed && !self.git_changed && !self.rescan
    }
}

pub(crate) struct Classifier {
    pub(crate) root: PathBuf,
    /// The checkout's own git dir; for a linked worktree it lies outside the root.
    pub(crate) git_dir: Option<PathBuf>,
    pub(crate) stack: SharedStack,
}

impl Classifier {
    pub(crate) fn add(&self, batch: &mut Batch, event: &notify::Event) {
        if event.need_rescan() {
            batch.rescan = true;
            return;
        }
        let structural = matches!(
            event.kind,
            EventKind::Create(_)
                | EventKind::Remove(_)
                | EventKind::Modify(ModifyKind::Name(_))
                | EventKind::Any
                | EventKind::Other
        );
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in &event.paths {
            self.add_path(batch, path, structural, &event.kind);
        }
    }

    fn add_path(&self, batch: &mut Batch, path: &Path, structural: bool, kind: &EventKind) {
        if let Some(git_rel) = self
            .git_dir
            .as_ref()
            .and_then(|g| path.strip_prefix(g).ok())
        {
            let git_rel = git_rel.to_string_lossy();
            if GIT_STATE.contains(&git_rel.as_ref()) || git_rel.starts_with("refs/") {
                batch.git_changed = true;
            }
            return;
        }
        let Ok(rel) = path.strip_prefix(&self.root) else {
            return;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            if matches!(kind, EventKind::Remove(_)) {
                batch.rescan = true;
            }
            return;
        }
        if rel.rsplit('/').next() == Some(".gitignore") {
            self.stack.lock().unwrap().forget();
            batch.rescan = true;
            return;
        }
        let class = self.stack.lock().unwrap().classify(&rel, path.is_dir());
        if class != Class::Visible {
            return;
        }
        if structural {
            let parent = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
            batch.dirs.insert(parent.to_string());
            batch.index_changed = true;
        } else {
            batch.git_changed = true;
        }
    }
}

/// Drains `rx` into batches that end after [`SETTLE`] of quiet or [`MAX_WAIT`],
/// handing each non-empty one to `emit`. A full queue (`overflow`) or a watcher
/// error turns the batch into a rescan. Returns when the watcher is dropped.
pub(crate) async fn run(
    mut rx: mpsc::Receiver<notify::Result<notify::Event>>,
    overflow: Arc<AtomicBool>,
    classifier: Classifier,
    emit: impl Fn(Batch),
) {
    let add = |batch: &mut Batch, item: notify::Result<notify::Event>| match item {
        Ok(event) => classifier.add(batch, &event),
        Err(_) => batch.rescan = true,
    };
    while let Some(first) = rx.recv().await {
        let mut batch = Batch::default();
        add(&mut batch, first);
        let deadline = tokio::time::Instant::now() + MAX_WAIT;
        let mut open = true;
        while open {
            tokio::select! {
                item = rx.recv() => match item {
                    Some(item) => add(&mut batch, item),
                    None => open = false,
                },
                _ = tokio::time::sleep(SETTLE) => break,
                _ = tokio::time::sleep_until(deadline) => break,
            }
        }
        if overflow.swap(false, Ordering::SeqCst) {
            batch.rescan = true;
        }
        if !batch.is_empty() {
            emit(batch);
        }
        if !open {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::explorer::IgnoreStack;
    use notify::event::{CreateKind, DataChange};

    fn classifier(root: &Path) -> Classifier {
        Classifier {
            git_dir: Some(root.join(".git")),
            root: root.to_path_buf(),
            stack: Arc::new(std::sync::Mutex::new(IgnoreStack::new(
                root,
                Some(&root.join(".git")),
            ))),
        }
    }

    fn event(kind: EventKind, path: PathBuf) -> notify::Event {
        notify::Event::new(kind).add_path(path)
    }

    #[test]
    fn hidden_and_worktree_paths_add_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let c = classifier(dir.path());
        let mut batch = Batch::default();
        for rel in [
            "node_modules/x/index.js",
            "target/debug/a.o",
            ".warpforge/worktrees/t_1/src/a.rs",
            ".DS_Store",
        ] {
            c.add(
                &mut batch,
                &event(EventKind::Create(CreateKind::File), dir.path().join(rel)),
            );
        }
        assert!(batch.is_empty(), "{batch:?}");
    }

    #[test]
    fn a_created_file_marks_its_folder_and_an_edit_only_git() {
        let dir = tempfile::tempdir().unwrap();
        let c = classifier(dir.path());
        let mut batch = Batch::default();
        c.add(
            &mut batch,
            &event(
                EventKind::Create(CreateKind::File),
                dir.path().join("src/a.rs"),
            ),
        );
        c.add(
            &mut batch,
            &event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                dir.path().join("README.md"),
            ),
        );
        assert_eq!(batch.dirs.iter().collect::<Vec<_>>(), ["src"]);
        assert!(batch.index_changed && batch.git_changed && !batch.rescan);
    }

    #[test]
    fn git_state_files_move_status_and_objects_do_not() {
        let dir = tempfile::tempdir().unwrap();
        let c = classifier(dir.path());
        let mut batch = Batch::default();
        let objects = dir.path().join(".git/objects/ab/cdef");
        c.add(
            &mut batch,
            &event(EventKind::Create(CreateKind::File), objects),
        );
        assert!(batch.is_empty());
        let index = dir.path().join(".git/index");
        c.add(
            &mut batch,
            &event(EventKind::Create(CreateKind::File), index),
        );
        assert!(batch.git_changed && batch.dirs.is_empty());
    }

    #[test]
    fn a_gitignore_edit_asks_for_a_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let c = classifier(dir.path());
        let mut batch = Batch::default();
        let path = dir.path().join("app/.gitignore");
        c.add(&mut batch, &event(EventKind::Modify(ModifyKind::Any), path));
        assert!(batch.rescan);
    }
}
