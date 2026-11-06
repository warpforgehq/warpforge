//! Keepers on tasks without a worktree: the branch a turn ended on, the
//! shared checkout's guards.

use super::fixer::{fix_task, loop_event};
use super::*;
use crate::daemon::actor::keepers::checkout::{NO_BRANCH, SHARED_CHECKOUT_BUSY};
use wire::KeeperLoopStatus;

/// Point the scripted git at the project's checkout, on `branch`.
fn on_branch(setup: &Setup, branch: Option<&str>) -> String {
    let root = setup.projects[0].path.clone();
    let mut s = setup.script.lock().unwrap();
    let change = s.changes[&setup.worktree].clone();
    s.changes.insert(root.clone(), change);
    s.heads.insert(root.clone(), "sha1".into());
    match branch {
        Some(branch) => s.branches.insert(root.clone(), branch.into()),
        None => s.branches.remove(&root),
    };
    root
}

async fn switches(daemon: &DaemonHandle, task_id: &str) -> wire::TaskKeepers {
    let task = daemon.tasks().await.into_iter().find(|t| t.id == task_id);
    task.and_then(|t| t.keepers).unwrap_or_default()
}

async fn until_held(setup: &Setup, task_id: &str, held: Option<&str>) {
    timeout(Duration::from_secs(10), async {
        loop {
            setup
                .daemon
                .send(Command::Keepers(KeeperCommand::Poll))
                .await;
            if switches(&setup.daemon, task_id).await.held.as_deref() == held {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{task_id} held by {held:?}"));
}

#[tokio::test]
async fn a_folder_task_owns_the_branch_its_last_turn_ended_on() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        vec![task("t_a", None), task("t_b", None)]
    })
    .await;
    let root = on_branch(&setup, None);
    commit(&setup, "t_a").await;
    until_held(&setup, "t_a", Some(NO_BRANCH)).await;
    assert!(
        checkers(&setup.daemon).await.is_empty(),
        "nothing on the base"
    );

    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    assert_eq!(run.head_sha, "sha1");
    let log = logged(&setup.log);
    assert_eq!(log[0]["cwd"], root.as_str(), "the project's checkout");
    let owned = switches(&setup.daemon, "t_a").await;
    assert_eq!(
        (owned.branch.as_deref(), owned.held),
        (Some("feat/x"), None)
    );

    commit(&setup, "t_b").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_b").await;
    assert_eq!(
        switches(&setup.daemon, "t_b").await.branch.as_deref(),
        Some("feat/x")
    );
    until_held(&setup, "t_a", Some(NO_BRANCH)).await;
    assert_eq!(switches(&setup.daemon, "t_a").await.branch, None);

    {
        let mut s = setup.script.lock().unwrap();
        s.branches.insert(root.clone(), "other".into());
        s.heads.insert(root.clone(), "sha2".into());
    }
    let away = "the checkout is on other, not feat/x";
    until_held(&setup, "t_b", Some(away)).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::State {
        task_id: "t_b".into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    let runs = rx.await.unwrap().unwrap().runs;
    assert!(
        runs.iter().all(|run| run.head_sha == "sha1"),
        "no check of another branch's HEAD"
    );
    setup.daemon.shutdown().await;
}

/// A branch nobody owns goes to the folder task that changed last, without
/// waiting for its turn to end; a task that owns a branch keeps it.
#[tokio::test]
async fn an_unowned_branch_goes_to_the_latest_folder_task() {
    let setup = setup(&[("review", REVIEW)], |_| {
        let mut older = task("t_a", None);
        older.updated_at = 1;
        let mut latest = task("t_b", None);
        latest.updated_at = 2;
        vec![older, latest]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    until_held(&setup, "t_b", None).await;
    assert_eq!(
        switches(&setup.daemon, "t_b").await.branch.as_deref(),
        Some("feat/x")
    );
    until_held(&setup, "t_a", Some(NO_BRANCH)).await;

    let root = setup.projects[0].path.clone();
    setup
        .script
        .lock()
        .unwrap()
        .branches
        .insert(root, "review/theirs".into());
    until_held(
        &setup,
        "t_b",
        Some("the checkout is on review/theirs, not feat/x"),
    )
    .await;
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn no_fix_while_another_session_works_in_the_checkout() {
    let mut setup = setup(&[("review", REVIEW)], |wt| {
        let mut owner = fix_task("t_a", wt);
        owner.worktree = None;
        let mut other = fix_task("t_b", wt);
        other.worktree = None;
        vec![owner, other]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    std::fs::write(&setup.hold, "HOLDME").unwrap();
    setup
        .daemon
        .session_prompt("t_b", "HOLDME, keep going", Vec::new())
        .await
        .unwrap();
    setup
        .daemon
        .session_prompt("t_a", "hello", Vec::new())
        .await
        .unwrap();
    let busy = loop_event(&mut setup, |s| {
        s.status == KeeperLoopStatus::Waiting && s.reason.as_deref() == Some(SHARED_CHECKOUT_BUSY)
    })
    .await;
    assert_eq!(busy.rounds, 0);
    setup.daemon.shutdown().await;
}
