use super::*;
use crate::daemon::diff::testsupport::init_repo;

/// Long enough for a native watcher to start and for a batch to settle.
const SETTLE_WAIT: Duration = Duration::from_millis(1500);

struct Fs {
    _dir: tempfile::TempDir,
    root: PathBuf,
    events: broadcast::Sender<Event>,
}

async fn repo() -> Fs {
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    init_repo(&root).await;
    std::fs::write(root.join(".gitignore"), "coverage/\n").unwrap();
    for rel in [
        "src",
        "coverage",
        "node_modules/pkg",
        ".warpforge/worktrees/t_1",
    ] {
        std::fs::create_dir_all(root.join(rel)).unwrap();
    }
    Fs {
        _dir: dir,
        events: broadcast::channel(64).0,
        root,
    }
}

fn write(root: &Path, rel: &str) {
    std::fs::write(root.join(rel), "x").unwrap();
}

/// Every `fs.changed` for `root` that arrives within `wait`.
async fn changes(
    rx: &mut broadcast::Receiver<Event>,
    root: &Path,
    wait: Duration,
) -> Vec<(Vec<String>, bool, bool)> {
    let name = root.to_string_lossy().into_owned();
    let mut out = Vec::new();
    let deadline = tokio::time::Instant::now() + wait;
    while let Ok(Ok(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        if let Event::FsChanged {
            root,
            dirs,
            index_changed,
            rescan,
            ..
        } = event
        {
            if root == name {
                out.push((dirs, index_changed, rescan));
            }
        }
    }
    out
}

/// Native watchers need a session the test sandbox lacks; polling exercises
/// the same batching, filtering and lifecycle.
fn registry(grace: Duration) -> Arc<Registry> {
    Registry::polling(grace, Duration::from_millis(50))
}

async fn watched(fs: &Fs, registry: &Arc<Registry>) -> broadcast::Receiver<Event> {
    let rx = fs.events.subscribe();
    registry.acquire(&fs.root, &fs.events).await.unwrap();
    for dir in [
        "src",
        "node_modules/pkg",
        "coverage",
        ".warpforge/worktrees/t_1",
    ] {
        registry.listed(&fs.root, &fs.root.join(dir));
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    rx
}

#[tokio::test]
async fn a_burst_of_new_files_is_one_batched_change() {
    let fs = repo().await;
    let registry = registry(GRACE);
    let mut rx = watched(&fs, &registry).await;

    for name in ["a.rs", "b.rs", "c.rs"] {
        write(&fs.root, &format!("src/{name}"));
    }

    assert_eq!(
        changes(&mut rx, &fs.root, SETTLE_WAIT).await,
        [(vec!["src".to_string()], true, false)]
    );
}

#[tokio::test]
async fn ignored_hidden_and_worktree_paths_say_nothing() {
    let fs = repo().await;
    let registry = registry(GRACE);
    let mut rx = watched(&fs, &registry).await;

    for i in 0..200 {
        write(&fs.root, &format!("node_modules/pkg/f{i}.js"));
    }
    write(&fs.root, "coverage/lcov.info");
    write(&fs.root, ".warpforge/worktrees/t_1/a.rs");

    assert_eq!(changes(&mut rx, &fs.root, SETTLE_WAIT).await, []);
}

#[tokio::test]
async fn the_last_lease_to_go_tears_the_watcher_down() {
    let fs = repo().await;
    let registry = registry(Duration::ZERO);
    let first = Lease::new(Arc::clone(&registry));
    let second = Lease::new(Arc::clone(&registry));
    first.watch(&fs.root, &fs.events).await.unwrap();
    second.watch(&fs.root, &fs.events).await.unwrap();

    drop(first);
    assert_eq!(registry.len(), 1);
    drop(second);
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn a_released_root_survives_the_grace_period_and_can_be_retaken() {
    let fs = repo().await;
    let registry = registry(Duration::from_millis(200));
    let lease = Lease::new(Arc::clone(&registry));
    lease.watch(&fs.root, &fs.events).await.unwrap();
    lease.unwatch(&fs.root);
    assert_eq!(registry.len(), 1);

    lease.watch(&fs.root, &fs.events).await.unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(registry.len(), 1, "a retaken root is not reaped");

    lease.unwatch(&fs.root);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(registry.len(), 0);
}

#[tokio::test]
async fn forget_drops_a_root_and_its_children_while_still_held() {
    let fs = repo().await;
    let registry = registry(GRACE);
    let worktree = fs.root.join(".warpforge/worktrees/t_1");
    let lease = Lease::new(Arc::clone(&registry));
    lease.watch(&fs.root, &fs.events).await.unwrap();
    lease.watch(&worktree, &fs.events).await.unwrap();

    registry.forget(&worktree);
    assert_eq!(registry.len(), 1);
    registry.forget(&fs.root);
    assert_eq!(registry.len(), 0);
    drop(lease);
}

#[tokio::test]
async fn past_the_cap_the_oldest_idle_root_makes_room() {
    let registry = registry(GRACE);
    let lease = Lease::new(Arc::clone(&registry));
    let mut repos = Vec::new();
    for _ in 0..MAX_ROOTS {
        let fs = repo().await;
        lease.watch(&fs.root, &fs.events).await.unwrap();
        repos.push(fs);
    }
    let extra = repo().await;
    assert!(lease.watch(&extra.root, &extra.events).await.is_err());

    lease.unwatch(&repos[0].root);
    lease.watch(&extra.root, &extra.events).await.unwrap();
    assert_eq!(registry.len(), MAX_ROOTS);
    assert!(registry.stack(&repos[0].root).is_none());
}
