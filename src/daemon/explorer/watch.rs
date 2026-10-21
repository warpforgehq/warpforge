//! Filesystem watchers for the Explorer (ADR 0028): one per watched root,
//! shared by every connection that asked for it, kept for a grace period after
//! the last one lets go, and torn down before its worktree is removed.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use notify::{RecursiveMode, Watcher};
use tokio::sync::{broadcast, mpsc};

use super::batch::{self, Batch, Classifier};
use super::{IgnoreStack, SharedStack};
use crate::daemon::actor::Event;

pub(crate) const MAX_ROOTS: usize = 16;
pub(crate) const GRACE: Duration = Duration::from_secs(30);
const QUEUE: usize = 4096;

/// inotify watches one directory at a time and the limit is per user, so on
/// Linux only the folders a client has listed are watched.
const PER_DIR: bool = cfg!(target_os = "linux");

static REGISTRY: LazyLock<Arc<Registry>> = LazyLock::new(|| Registry::new(GRACE));

/// The daemon's watchers.
pub(crate) fn registry() -> &'static Arc<Registry> {
    &REGISTRY
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WatchInfo {
    pub(crate) root: String,
    pub(crate) degraded: bool,
}

pub(crate) struct Registry {
    roots: Mutex<HashMap<PathBuf, Entry>>,
    grace: Duration,
    generation: AtomicU64,
    /// Poll at this interval instead of using the native watcher (tests).
    poll: Option<Duration>,
}

struct Entry {
    refs: usize,
    generation: u64,
    idle_since: Option<Instant>,
    stack: SharedStack,
    watcher: Box<dyn Watcher + Send>,
    watched: HashSet<PathBuf>,
    degraded: Arc<AtomicBool>,
    events: broadcast::Sender<Event>,
    batcher: tokio::task::JoinHandle<()>,
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.batcher.abort();
    }
}

impl Registry {
    pub(crate) fn new(grace: Duration) -> Arc<Self> {
        Arc::new(Self {
            generation: AtomicU64::new(0),
            grace,
            poll: None,
            roots: Mutex::new(HashMap::new()),
        })
    }

    #[cfg(test)]
    pub(crate) fn polling(grace: Duration, interval: Duration) -> Arc<Self> {
        Arc::new(Self {
            generation: AtomicU64::new(0),
            grace,
            poll: Some(interval),
            roots: Mutex::new(HashMap::new()),
        })
    }

    /// Adds a reference to `root`'s watcher, starting one if needed.
    /// `root` must be canonical; events go out on `events`.
    pub(crate) async fn acquire(
        self: &Arc<Self>,
        root: &Path,
        events: &broadcast::Sender<Event>,
    ) -> Result<WatchInfo> {
        if let Some(info) = self.add_ref(root) {
            return Ok(info);
        }
        let entry = start(root, events.clone(), self.poll).await?;
        let mut roots = self.roots.lock().unwrap();
        if let Some(existing) = roots.get_mut(root) {
            existing.refs += 1;
            existing.idle_since = None;
            return Ok(info(root, existing));
        }
        if roots.len() >= MAX_ROOTS {
            let oldest = roots
                .iter()
                .filter_map(|(path, e)| e.idle_since.map(|since| (since, path.clone())))
                .min();
            let Some((_, oldest)) = oldest else {
                bail!("too many folders are being watched");
            };
            roots.remove(&oldest);
        }
        let info = info(root, &entry);
        roots.insert(root.to_path_buf(), entry);
        Ok(info)
    }

    fn add_ref(&self, root: &Path) -> Option<WatchInfo> {
        let mut roots = self.roots.lock().unwrap();
        let entry = roots.get_mut(root)?;
        entry.refs += 1;
        entry.idle_since = None;
        Some(info(root, entry))
    }

    /// Drops a reference; the watcher outlives the last one by the grace period.
    pub(crate) fn release(self: &Arc<Self>, root: &Path) {
        let generation = {
            let mut roots = self.roots.lock().unwrap();
            let Some(entry) = roots.get_mut(root) else {
                return;
            };
            entry.refs = entry.refs.saturating_sub(1);
            if entry.refs > 0 {
                return;
            }
            entry.idle_since = Some(Instant::now());
            entry.generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
            entry.generation
        };
        if self.grace.is_zero() {
            self.reap(root, generation);
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let this = Arc::clone(self);
        let root = root.to_path_buf();
        let grace = self.grace;
        runtime.spawn(async move {
            tokio::time::sleep(grace).await;
            this.reap(&root, generation);
        });
    }

    fn reap(&self, root: &Path, generation: u64) {
        let mut roots = self.roots.lock().unwrap();
        if roots
            .get(root)
            .is_some_and(|e| e.refs == 0 && e.generation == generation)
        {
            roots.remove(root);
        }
    }

    /// Stops watching `root` and everything under it at once, references or
    /// not. Called before a worktree is removed.
    pub(crate) fn forget(&self, root: &Path) {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        self.roots
            .lock()
            .unwrap()
            .retain(|path, _| !path.starts_with(&root));
    }

    /// The cached matcher of a watched root, kept current by its watcher.
    pub(crate) fn stack(&self, root: &Path) -> Option<SharedStack> {
        let roots = self.roots.lock().unwrap();
        roots.get(root).map(|e| Arc::clone(&e.stack))
    }

    /// Records that a client listed `dir` under `root`. Where watches are per
    /// directory, this is what adds one; running out of them degrades the root.
    pub(crate) fn listed(&self, root: &Path, dir: &Path) {
        if !PER_DIR {
            return;
        }
        let mut roots = self.roots.lock().unwrap();
        let Some(entry) = roots.get_mut(root) else {
            return;
        };
        if entry.degraded.load(Ordering::SeqCst) || !entry.watched.insert(dir.to_path_buf()) {
            return;
        }
        if let Err(error) = entry.watcher.watch(dir, RecursiveMode::NonRecursive) {
            if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
                entry.degraded.store(true, Ordering::SeqCst);
                let _ = entry.events.send(Event::FsChanged {
                    degraded: true,
                    dirs: Vec::new(),
                    index_changed: false,
                    rescan: false,
                    root: root.to_string_lossy().into_owned(),
                });
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.roots.lock().unwrap().len()
    }
}

fn info(root: &Path, entry: &Entry) -> WatchInfo {
    WatchInfo {
        degraded: entry.degraded.load(Ordering::SeqCst),
        root: root.to_string_lossy().into_owned(),
    }
}

async fn git_dir(root: &Path) -> Option<PathBuf> {
    let out = tokio::process::Command::new("git")
        .args(["--no-optional-locks", "-C"])
        .arg(root)
        .args(["rev-parse", "--path-format=absolute", "--git-dir"])
        .output()
        .await
        .ok()?;
    out.status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
}

async fn start(
    root: &Path,
    events: broadcast::Sender<Event>,
    poll: Option<Duration>,
) -> Result<Entry> {
    let stack: SharedStack = Arc::new(Mutex::new(IgnoreStack::open(root).await));
    let git_dir = git_dir(root).await;
    let (tx, rx) = mpsc::channel(QUEUE);
    let overflow = Arc::new(AtomicBool::new(false));
    let lost = Arc::clone(&overflow);
    let handler = move |item| {
        if tx.try_send(item).is_err() {
            lost.store(true, Ordering::SeqCst);
        }
    };
    let mut watcher: Box<dyn Watcher + Send> = match poll {
        Some(interval) => Box::new(notify::PollWatcher::new(
            handler,
            notify::Config::default().with_poll_interval(interval),
        )?),
        None => Box::new(notify::recommended_watcher(handler)?),
    };
    let degraded = Arc::new(AtomicBool::new(false));
    let mode = if PER_DIR {
        RecursiveMode::NonRecursive
    } else {
        RecursiveMode::Recursive
    };
    let mut watched = HashSet::from([root.to_path_buf()]);
    if let Err(error) = watcher.watch(root, mode) {
        if !matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
            return Err(error.into());
        }
        degraded.store(true, Ordering::SeqCst);
    }
    if let Some(git) = git_dir.as_ref().filter(|g| PER_DIR || !g.starts_with(root)) {
        if watcher.watch(git, RecursiveMode::NonRecursive).is_ok() {
            watched.insert(git.clone());
        }
    }

    let classifier = Classifier {
        git_dir,
        root: root.to_path_buf(),
        stack: Arc::clone(&stack),
    };
    let sink = events.clone();
    let name = root.to_string_lossy().into_owned();
    let flagged = Arc::clone(&degraded);
    let batcher = tokio::spawn(batch::run(rx, overflow, classifier, move |b: Batch| {
        let _ = sink.send(Event::FsChanged {
            degraded: flagged.load(Ordering::SeqCst),
            dirs: b.dirs.into_iter().collect(),
            index_changed: b.index_changed,
            rescan: b.rescan,
            root: name.clone(),
        });
    }));
    Ok(Entry {
        batcher,
        degraded,
        events,
        generation: 0,
        idle_since: None,
        refs: 1,
        stack,
        watched,
        watcher,
    })
}

/// One connection's references. Dropping it, when the connection closes,
/// releases every root it still holds.
pub(crate) struct Lease {
    registry: Arc<Registry>,
    roots: Mutex<HashMap<PathBuf, usize>>,
}

impl Lease {
    pub(crate) fn new(registry: Arc<Registry>) -> Self {
        Self {
            registry,
            roots: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn watch(
        &self,
        root: &Path,
        events: &broadcast::Sender<Event>,
    ) -> Result<WatchInfo> {
        let info = self.registry.acquire(root, events).await?;
        *self
            .roots
            .lock()
            .unwrap()
            .entry(root.to_path_buf())
            .or_default() += 1;
        Ok(info)
    }

    pub(crate) fn unwatch(&self, root: &Path) {
        let held = {
            let mut roots = self.roots.lock().unwrap();
            match roots.get_mut(root) {
                Some(count) if *count > 1 => {
                    *count -= 1;
                    true
                }
                Some(_) => roots.remove(root).is_some(),
                None => false,
            }
        };
        if held {
            self.registry.release(root);
        }
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        for (root, count) in self.roots.lock().unwrap().drain() {
            for _ in 0..count {
                self.registry.release(&root);
            }
        }
    }
}

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
