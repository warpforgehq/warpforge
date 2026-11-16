//! Merge-back through the actor: the merge result is applied to the task and
//! the worktree is removed only when the caller asked for it.

use crate::daemon::actor::*;
use crate::registry::ProjectEntry;
use std::path::Path;
use std::time::Duration;

const MOCK_AGENT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-inspect.mjs"
);

fn git(dir: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .env("LC_ALL", "C")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn repo_with_commit() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    std::fs::write(dir.path().join("README.md"), "init\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-qm", "init"]);
    dir
}

fn spawn_with_repo(dir: &tempfile::TempDir) -> DaemonHandle {
    Daemon::spawn(
        vec![ProjectEntry {
            name: "demo".into(),
            path: dir.path().to_string_lossy().into_owned(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        }],
        None,
    )
}

async fn create_worktree_task(handle: &DaemonHandle) -> String {
    handle
        .create_task(
            "demo",
            "do the thing",
            &format!("node {MOCK_AGENT}"),
            Vec::new(),
            false,
            true,
            None,
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await
}

async fn wait_for_worktree(handle: &DaemonHandle, id: &str) -> String {
    for _ in 0..200 {
        let task = handle
            .tasks()
            .await
            .into_iter()
            .find(|t| t.id == id)
            .expect("task on the board");
        if let Some(path) = task.worktree {
            return path;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("worktree never attached");
}

async fn task_now(handle: &DaemonHandle, id: &str) -> crate::daemon::task::Task {
    handle
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .expect("task on the board")
}

/// Commit a change in the task's checkout so there is something to merge.
fn commit_in_worktree(path: &str) {
    let wt = Path::new(path);
    std::fs::write(wt.join("work.txt"), "task work\n").unwrap();
    git(wt, &["add", "."]);
    git(wt, &["commit", "-qm", "task work"]);
}

/// Wait until the agent's first turn is over, so a merge is not refused for a
/// turn that is still running. The task is `Queued` until its session attaches.
async fn wait_for_turn_end(handle: &DaemonHandle, id: &str) {
    for _ in 0..200 {
        let task = task_now(handle, id).await;
        if task.session_id.is_some() && task.status != crate::daemon::task::TaskStatus::Running {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("the agent's turn never ended");
}

/// Wait for an `AgentExited` for `terminal_id`, proving the merge killed it.
async fn wait_for_agent_exit(
    events: &mut tokio::sync::broadcast::Receiver<Event>,
    terminal_id: &str,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(Event::AgentExited { id }) = events.recv().await {
                if id == terminal_id {
                    return;
                }
            }
        }
    })
    .await
    .expect("the merge must kill the task's terminal");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn merge_keeps_the_worktree_when_asked() {
    let dir = repo_with_commit();
    let handle = spawn_with_repo(&dir);
    let id = create_worktree_task(&handle).await;
    let path = wait_for_worktree(&handle, &id).await;
    wait_for_turn_end(&handle, &id).await;
    commit_in_worktree(&path);

    let message = handle
        .merge_worktree(&id, false)
        .await
        .expect("merge succeeds");
    assert!(message.to_lowercase().contains("main"), "{message}");

    assert!(Path::new(&path).exists(), "the worktree must be kept");
    let task = task_now(&handle, &id).await;
    assert!(task.worktree.is_some(), "task still records its worktree");
    assert_eq!(task.base_branch.as_deref(), Some("main"));
    assert_ne!(
        task.status,
        crate::daemon::task::TaskStatus::Done,
        "keeping the worktree leaves the task status alone"
    );
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn merge_removes_the_worktree_by_default() {
    let dir = repo_with_commit();
    let handle = spawn_with_repo(&dir);
    let id = create_worktree_task(&handle).await;
    let path = wait_for_worktree(&handle, &id).await;
    wait_for_turn_end(&handle, &id).await;
    commit_in_worktree(&path);

    // A terminal scoped to the task, like the task's own Terminal tab.
    let mut events = handle.subscribe();
    let terminal = handle
        .spawn_agent(
            "demo",
            "sleep 60",
            "test terminal",
            80,
            24,
            Some(id.clone()),
        )
        .await
        .expect("terminal spawns");

    handle
        .merge_worktree(&id, true)
        .await
        .expect("merge succeeds");
    wait_for_agent_exit(&mut events, &terminal).await;

    let mut gone = false;
    for _ in 0..200 {
        if !Path::new(&path).exists() {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(gone, "the worktree must be removed after the merge");
    let task = task_now(&handle, &id).await;
    assert_eq!(task.worktree, None, "task clears its worktree");
    assert_eq!(task.base_branch, None, "task clears its base branch");
    assert_eq!(
        task.status,
        crate::daemon::task::TaskStatus::Done,
        "merged work is finished"
    );
    assert_eq!(task.session_id, None, "the live session is dropped");
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn merge_is_refused_while_a_turn_is_running() {
    let dir = repo_with_commit();
    let handle = spawn_with_repo(&dir);
    let id = create_worktree_task(&handle).await;
    let path = wait_for_worktree(&handle, &id).await;
    wait_for_turn_end(&handle, &id).await;
    commit_in_worktree(&path);

    handle
        .set_task_status(&id, crate::daemon::task::TaskStatus::Running)
        .await;
    let error = handle
        .merge_worktree(&id, true)
        .await
        .expect_err("a running turn refuses the merge");
    assert!(
        error.contains("wait for the agent to finish its turn"),
        "{error}"
    );

    assert!(Path::new(&path).exists(), "nothing was removed");
    handle.shutdown().await;
}
