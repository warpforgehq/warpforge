//! Pull-request state of branch-owning tasks, for the sidebar row and the task
//! header. A cache refreshed from GitHub on spawned tasks, never on the actor
//! loop; changes go out as `task.pullRequest` (docs/adr/0020).

mod checks;
mod comments;
mod github;
mod removal;
mod targets;
pub(crate) use targets::targets;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::{broadcast, mpsc, oneshot, Semaphore};
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle, Event};
use crate::daemon::task::Task;

pub(crate) use checks::{check_name, check_state};
pub(crate) use github::Listed;
pub(crate) use removal::removal_blocker;

/// How often open pull requests are re-checked once a client has asked.
const POLL_INTERVAL: Duration = Duration::from_secs(180);
/// Staleness a client refresh tolerates unless it names its own.
const DEFAULT_MAX_AGE: Duration = Duration::from_secs(120);
const MAX_CONCURRENT_FETCHES: usize = 4;
/// Longest the review remarks are trusted while `updatedAt` stands still;
/// resolving a thread need not move it.
const COMMENTS_MAX_AGE: Duration = Duration::from_secs(15 * 60);

/// Where to look for a task's pull request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PullTarget {
    pub worktree: String,
    pub base_branch: Option<String>,
    /// The pull request's head branch when it is not what `worktree` has
    /// checked out: an owned folder branch or a Factory task branch.
    pub head: Option<String>,
}

type FetchFuture = Pin<Box<dyn Future<Output = Result<Option<Listed>>> + Send>>;
pub(crate) type Fetcher = Arc<dyn Fn(PullTarget) -> FetchFuture + Send + Sync>;
type CommentsFuture = Pin<Box<dyn Future<Output = Result<Vec<wire::PullComment>>> + Send>>;
/// Reads the open review remarks of pull request `number` from a worktree.
pub(crate) type CommentsFetcher = Arc<dyn Fn(String, u64) -> CommentsFuture + Send + Sync>;

struct Entry {
    target: PullTarget,
    pull: Option<wire::TaskPullRequest>,
    checked_at: Option<Instant>,
    in_flight: bool,
    again: bool,
    updated_at: String,
    comments_at: Option<Instant>,
}

/// One settled fetch: the listing with its remarks filled in, and when those
/// remarks were last read from GitHub (`None` when that read failed).
type Fetched = (Listed, Option<Instant>);

pub struct PullWatch {
    fetch: Fetcher,
    comments: CommentsFetcher,
    entries: Mutex<HashMap<String, Entry>>,
    permits: Semaphore,
    polling: AtomicBool,
}

impl Default for PullWatch {
    fn default() -> Self {
        #[cfg(not(test))]
        let fetch: Fetcher = Arc::new(|target| Box::pin(github::fetch(target)));
        #[cfg(test)]
        let fetch: Fetcher = Arc::new(|_| Box::pin(async { Ok(None) }));
        #[cfg(not(test))]
        let comments: CommentsFetcher =
            Arc::new(|worktree, number| Box::pin(comments::fetch(worktree, number)));
        #[cfg(test)]
        let comments: CommentsFetcher = Arc::new(|_, _| Box::pin(async { Ok(Vec::new()) }));
        Self::new(fetch, comments)
    }
}

impl PullWatch {
    pub(crate) fn new(fetch: Fetcher, comments: CommentsFetcher) -> Self {
        Self {
            fetch,
            comments,
            entries: Mutex::new(HashMap::new()),
            permits: Semaphore::new(MAX_CONCURRENT_FETCHES),
            polling: AtomicBool::new(false),
        }
    }

    /// Re-check the tasks in `only` (all of `targets` when `None`) whose state
    /// is older than `max_age`, and drop entries whose task is gone or moved.
    /// Returns the cache as it stands; fetch results arrive as events.
    pub(crate) fn refresh(
        self: &Arc<Self>,
        targets: HashMap<String, PullTarget>,
        only: Option<&[String]>,
        max_age: Duration,
        events: &broadcast::Sender<Event>,
    ) -> HashMap<String, wire::TaskPullRequest> {
        let now = Instant::now();
        let mut due = Vec::new();
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|id, entry| {
            let keep = targets.get(id) == Some(&entry.target);
            if !keep && entry.pull.is_some() {
                emit(events, id, None);
            }
            keep
        });
        for (id, target) in &targets {
            if only.is_some_and(|ids| !ids.contains(id)) {
                continue;
            }
            let entry = entries.entry(id.clone()).or_insert_with(|| Entry {
                target: target.clone(),
                pull: None,
                checked_at: None,
                in_flight: false,
                again: false,
                updated_at: String::new(),
                comments_at: None,
            });
            if entry
                .checked_at
                .is_some_and(|at| now.duration_since(at) < max_age)
            {
                continue;
            }
            if entry.in_flight {
                entry.again |= max_age.is_zero();
                continue;
            }
            entry.in_flight = true;
            due.push((id.clone(), target.clone()));
        }
        let cached = cached(&entries);
        drop(entries);
        for (id, target) in due {
            self.spawn_fetch(id, target, events.clone());
        }
        cached
    }

    /// Forget a task whose checkout is going away, clearing it on clients.
    pub(crate) fn forget(&self, task_id: &str, events: &broadcast::Sender<Event>) {
        let removed = self.entries.lock().unwrap().remove(task_id);
        if removed.is_some_and(|entry| entry.pull.is_some()) {
            emit(events, task_id, None);
        }
    }

    /// Head commit of the task's pull request, when one is known.
    pub(crate) fn head_oid(&self, task_id: &str) -> Option<String> {
        let entries = self.entries.lock().unwrap();
        entries.get(task_id)?.pull.as_ref()?.head_oid.clone()
    }

    fn open_task_ids(&self) -> Vec<String> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, entry)| {
                entry.pull.as_ref().is_some_and(|pull| {
                    matches!(
                        pull.state,
                        wire::TaskPullState::Open | wire::TaskPullState::Draft
                    )
                })
            })
            .map(|(id, _)| id.clone())
            .collect()
    }

    fn spawn_fetch(
        self: &Arc<Self>,
        id: String,
        target: PullTarget,
        events: broadcast::Sender<Event>,
    ) {
        let watch = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let result = {
                    let _permit = watch.permits.acquire().await;
                    match (watch.fetch)(target.clone()).await {
                        Ok(Some(listed)) => {
                            Ok(Some(watch.with_comments(&id, &target, listed).await))
                        }
                        other => other.map(|_| None),
                    }
                };
                if !watch.settle(&id, &target, result, &events) {
                    return;
                }
            }
        });
    }

    /// Fill in an open pull request's review remarks. They are read again only
    /// when `updatedAt` moved or they are older than [`COMMENTS_MAX_AGE`]; a
    /// failed read keeps the ones already known and retries next time.
    async fn with_comments(&self, id: &str, target: &PullTarget, mut listed: Listed) -> Fetched {
        if !matches!(
            listed.pull.state,
            wire::TaskPullState::Open | wire::TaskPullState::Draft
        ) {
            return (listed, None);
        }
        let known = {
            let entries = self.entries.lock().unwrap();
            entries.get(id).and_then(|entry| {
                let pull = entry.pull.as_ref()?;
                let same = pull.number == listed.pull.number;
                let fresh = !entry.updated_at.is_empty()
                    && entry.updated_at == listed.updated_at
                    && entry
                        .comments_at
                        .is_some_and(|at| at.elapsed() < COMMENTS_MAX_AGE);
                same.then(|| {
                    (
                        pull.open_comments.clone(),
                        entry.comments_at.filter(|_| fresh),
                    )
                })
            })
        };
        if let Some((comments, Some(at))) = known {
            listed.pull.open_comments = comments;
            return (listed, Some(at));
        }
        match (self.comments)(target.worktree.clone(), listed.pull.number).await {
            Ok(comments) => {
                listed.pull.open_comments = comments;
                (listed, Some(Instant::now()))
            }
            Err(_) => {
                listed.pull.open_comments = known.map(|(comments, _)| comments).unwrap_or_default();
                (listed, None)
            }
        }
    }

    /// Record one fetch. A failure keeps the last known state: no credential,
    /// signed out or offline must not flap a badge. Returns whether a forced
    /// refresh arrived meanwhile and the fetch should run again.
    fn settle(
        &self,
        id: &str,
        target: &PullTarget,
        result: Result<Option<Fetched>>,
        events: &broadcast::Sender<Event>,
    ) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let Some(entry) = entries.get_mut(id).filter(|entry| &entry.target == target) else {
            return false;
        };
        if let Ok(fetched) = result {
            let (pull, updated_at, comments_at) = match fetched {
                Some((listed, at)) => (Some(listed.pull), listed.updated_at, at),
                None => (None, String::new(), None),
            };
            entry.updated_at = updated_at;
            entry.comments_at = comments_at;
            if entry.pull != pull {
                entry.pull = pull.clone();
                emit(events, id, pull);
            }
        }
        entry.checked_at = Some(Instant::now());
        if std::mem::take(&mut entry.again) {
            return true;
        }
        entry.in_flight = false;
        false
    }

    /// Start re-checking open pull requests every few minutes. Holds only a
    /// weak sender, so a dropped daemon ends the loop.
    fn ensure_polling(self: &Arc<Self>, handle: &DaemonHandle) {
        if self.polling.swap(true, Ordering::SeqCst) {
            return;
        }
        let watch = Arc::clone(self);
        let cmd_tx = handle.cmd_tx.downgrade();
        let events = handle.event_tx.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(POLL_INTERVAL);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            tick.tick().await;
            loop {
                tick.tick().await;
                let Some(cmd_tx) = cmd_tx.upgrade() else {
                    return;
                };
                let open = watch.open_task_ids();
                if open.is_empty() {
                    continue;
                }
                let tasks = list_tasks(&cmd_tx).await;
                let paths = list_project_paths(&cmd_tx).await;
                drop(cmd_tx);
                let max_age = POLL_INTERVAL - Duration::from_secs(30);
                watch.refresh(targets(&tasks, &paths), Some(&open), max_age, &events);
            }
        });
    }
}

/// Refresh through a daemon handle and start the background poll.
pub(crate) async fn refresh(
    handle: &DaemonHandle,
    only: Option<&[String]>,
    max_age_secs: Option<u64>,
) -> HashMap<String, wire::TaskPullRequest> {
    handle.pulls.ensure_polling(handle);
    let max_age = max_age_secs.map_or(DEFAULT_MAX_AGE, Duration::from_secs);
    let tasks = handle.tasks().await;
    let paths = project_paths(handle.projects().await);
    handle
        .pulls
        .refresh(targets(&tasks, &paths), only, max_age, &handle.event_tx)
}

fn project_paths(projects: Vec<crate::registry::ProjectEntry>) -> HashMap<String, String> {
    projects.into_iter().map(|p| (p.name, p.path)).collect()
}

async fn list_project_paths(cmd_tx: &mpsc::Sender<Command>) -> HashMap<String, String> {
    let (tx, rx) = oneshot::channel();
    if cmd_tx.send(Command::Projects(tx)).await.is_err() {
        return HashMap::new();
    }
    project_paths(rx.await.unwrap_or_default())
}

async fn list_tasks(cmd_tx: &mpsc::Sender<Command>) -> Vec<Task> {
    let (tx, rx) = oneshot::channel();
    if cmd_tx.send(Command::Tasks(tx)).await.is_err() {
        return Vec::new();
    }
    rx.await.unwrap_or_default()
}

fn cached(entries: &HashMap<String, Entry>) -> HashMap<String, wire::TaskPullRequest> {
    entries
        .iter()
        .filter_map(|(id, entry)| Some((id.clone(), entry.pull.clone()?)))
        .collect()
}

fn emit(events: &broadcast::Sender<Event>, task_id: &str, pull: Option<wire::TaskPullRequest>) {
    let _ = events.send(Event::TaskPullRequest {
        task_id: task_id.to_string(),
        pull_request: pull,
    });
}
