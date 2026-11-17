//! Keepers on tasks without a worktree: the branch a turn ended on, the
//! shared checkout's guards.

use super::fixer::{fix_prompts, fix_task, loop_event, prompts, until, wake};
use super::*;
use crate::daemon::actor::keepers::checkout::{NO_BRANCH, SHARED_CHECKOUT_BUSY};
use wire::KeeperLoopStatus;

/// Point the scripted git at the project's checkout, on `branch`.
pub(super) fn on_branch(setup: &Setup, branch: Option<&str>) -> String {
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

pub(super) async fn switches(daemon: &DaemonHandle, task_id: &str) -> wire::TaskKeepers {
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
    let runs = ask(&setup, |reply| KeeperCommand::State {
        task_id: "t_b".into(),
        reply,
    })
    .await
    .unwrap()
    .runs;
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
    until_held(&setup, "t_a", Some(NO_BRANCH)).await;
    until_held(&setup, "t_b", None).await;
    assert_eq!(
        switches(&setup.daemon, "t_b").await.branch.as_deref(),
        Some("feat/x")
    );

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

/// An orchestrator's turns end all the time without a commit; they must not
/// take the branch from the session whose commit it is.
#[tokio::test]
async fn a_turn_that_moved_no_head_does_not_take_the_branch() {
    let setup = setup(&[("review", REVIEW)], |wt| {
        let mut talker = fix_task("t_b", wt);
        talker.worktree = None;
        vec![task("t_a", None), talker]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;
    until_held(&setup, "t_b", Some(NO_BRANCH)).await;

    setup
        .daemon
        .session_prompt("t_b", "how is it going?", Vec::new())
        .await
        .unwrap();
    until("the turn to end", || prompts(&setup.fix_log).len() == 1).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    until_held(&setup, "t_b", Some(NO_BRANCH)).await;
    assert_eq!(
        switches(&setup.daemon, "t_a").await.branch.as_deref(),
        Some("feat/x"),
        "the committer keeps its branch"
    );
    setup.daemon.shutdown().await;
}

pub(super) async fn until_branch(setup: &Setup, task_id: &str, branch: Option<&str>) {
    timeout(Duration::from_secs(10), async {
        loop {
            setup
                .daemon
                .send(Command::Keepers(KeeperCommand::Poll))
                .await;
            if switches(&setup.daemon, task_id).await.branch.as_deref() == branch {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{task_id} owns {branch:?}"));
}

/// Wait until a poll has read the checkout's `head` and recorded it on a task
/// that may check: that poll, and so every nudge armed before it, has landed.
pub(super) async fn until_head(setup: &Setup, task_id: &str, head: &str) {
    timeout(Duration::from_secs(10), async {
        loop {
            setup
                .daemon
                .send(Command::Keepers(KeeperCommand::Poll))
                .await;
            if switches(&setup.daemon, task_id).await.head.as_deref() == Some(head) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{task_id} polled {head}"));
}

/// Move the shared checkout's HEAD, as a folder task's commit would.
pub(super) async fn move_checkout_head(setup: &Setup, sha: &str) {
    let root = setup.projects[0].path.clone();
    let mut s = setup.script.lock().unwrap();
    s.heads.insert(root.clone(), sha.into());
    let change = s.changes.get_mut(&root).unwrap();
    change.log.insert(0, format!("{sha} follow-up"));
}

/// `keepers.state` for an arbitrary task.
async fn task_state(setup: &Setup, task_id: &str) -> wire::KeeperTaskState {
    ask(setup, |reply| KeeperCommand::State {
        task_id: task_id.into(),
        reply,
    })
    .await
    .unwrap()
}

/// A sub-agent commits mid-turn while another task owns the branch: the poll
/// attributes the new HEAD to the running task, whose mid-turn holds the check
/// until its turn ends, so the findings land on it, not the owner.
#[tokio::test]
async fn a_mid_turn_commit_is_attributed_to_the_running_task() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        vec![task("t_a", None), task("t_b", None)]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;

    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Running)
        .await;
    turn_began(&setup, "t_b").await;
    move_checkout_head(&setup, "sha2").await;
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;

    until_branch(&setup, "t_b", Some("feat/x")).await;
    until_branch(&setup, "t_a", None).await;
    let held_back = task_state(&setup, "t_b").await.runs;
    assert!(
        held_back.iter().all(|r| r.head_sha != "sha2"),
        "the running task checks only once its turn ends: {held_back:?}"
    );

    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Waiting)
        .await;
    commit(&setup, "t_b").await;
    let (run, _) = keeper_event(&mut setup, |r| finished(r) && r.head_sha == "sha2").await;
    assert_eq!(run.task_id, "t_b", "the committer's findings go to it");
    setup.daemon.shutdown().await;
}

/// Two folder sessions mid-turn leave the author ambiguous: nobody checks the
/// new HEAD until one of them ends and the poll attributes the other.
#[tokio::test]
async fn two_mid_turn_sessions_hold_the_check_until_one_ends() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        vec![task("t_a", None), task("t_b", None), task("t_c", None)]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;

    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Running)
        .await;
    turn_began(&setup, "t_b").await;
    setup
        .daemon
        .set_task_status("t_c", TaskStatus::Running)
        .await;
    turn_began(&setup, "t_c").await;
    move_checkout_head(&setup, "sha2").await;
    commit(&setup, "t_a").await;

    until_held(&setup, "t_a", Some(SHARED_CHECKOUT_BUSY)).await;
    assert_eq!(
        switches(&setup.daemon, "t_a").await.branch.as_deref(),
        Some("feat/x"),
        "an ambiguous commit does not move the branch"
    );
    let runs = task_state(&setup, "t_a").await.runs;
    assert!(
        runs.iter().all(|r| r.head_sha != "sha2"),
        "no check while the author is ambiguous: {runs:?}"
    );

    setup
        .daemon
        .set_task_status("t_c", TaskStatus::Waiting)
        .await;
    until_branch(&setup, "t_b", Some("feat/x")).await;

    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Waiting)
        .await;
    commit(&setup, "t_b").await;
    let (run, _) = keeper_event(&mut setup, |r| finished(r) && r.head_sha == "sha2").await;
    assert_eq!(run.task_id, "t_b");
    setup.daemon.shutdown().await;
}

/// A folder task that loses its branch has its open findings superseded: the
/// new owner's next check reads the whole diff and reports anything still true.
#[tokio::test]
async fn losing_the_branch_supersedes_open_findings() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        vec![task("t_a", None), task("t_b", None)]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    let (_, findings) = keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    assert!(
        findings
            .iter()
            .any(|f| f.status == wire::KeeperFindingStatus::Open),
        "{findings:?}"
    );

    commit(&setup, "t_b").await;
    until_branch(&setup, "t_b", Some("feat/x")).await;
    until_branch(&setup, "t_a", None).await;

    let state = task_state(&setup, "t_a").await;
    assert!(!state.findings.is_empty());
    assert!(
        state
            .findings
            .iter()
            .all(|f| f.status == wire::KeeperFindingStatus::Superseded),
        "{:?}",
        state.findings
    );
    setup.daemon.shutdown().await;
}

/// A folder task that loses its branch mid-fix has that fix dropped: nothing
/// is sent from the old HEAD (invariant 4), and the keeper returns to idle.
#[tokio::test]
async fn losing_the_branch_drops_a_pending_fix() {
    let mut setup = setup(&[("review", REVIEW)], |wt| {
        let mut owner = fix_task("t_a", wt);
        owner.worktree = None;
        let mut other = fix_task("t_b", wt);
        other.worktree = None;
        vec![owner, other]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    let root = setup.projects[0].path.clone();
    setup.script.lock().unwrap().dirty.insert(root.clone());
    commit(&setup, "t_a").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;
    loop_event(&mut setup, |s| {
        s.status == KeeperLoopStatus::Waiting && s.reason.is_some()
    })
    .await;

    // t_b's own check of the same HEAD approves, so any fix sent below is
    // t_a's.
    std::fs::write(&setup.replies, APPROVE).unwrap();
    commit(&setup, "t_b").await;
    until_branch(&setup, "t_b", Some("feat/x")).await;
    until_branch(&setup, "t_a", None).await;
    // Clear the worktree only once the branch is gone: a clean checkout
    // before that would let the pending fix go from the old HEAD.
    setup.script.lock().unwrap().dirty.clear();
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let state = task_state(&setup, "t_a").await;
    assert!(
        state
            .findings
            .iter()
            .all(|f| f.status == wire::KeeperFindingStatus::Superseded),
        "{:?}",
        state.findings
    );
    assert_eq!(
        state.loops["review"].status,
        KeeperLoopStatus::Idle,
        "the pending fix is dropped"
    );
    assert!(fix_prompts(&setup).is_empty(), "no fix from the old HEAD");
    setup.daemon.shutdown().await;
}

/// A hand commit with nobody mid-turn stays with the current owner: no heir or
/// runner steals the branch, and the owner checks it.
#[tokio::test]
async fn a_hand_commit_with_nobody_running_stays_with_the_owner() {
    let mut setup = setup(&[("review", REVIEW)], |_| {
        let mut latest = task("t_b", None);
        latest.updated_at = 2;
        vec![task("t_a", None), latest]
    })
    .await;
    on_branch(&setup, Some("feat/x"));
    commit(&setup, "t_a").await;
    keeper_event(&mut setup, |r| finished(r) && r.task_id == "t_a").await;
    until_branch(&setup, "t_a", Some("feat/x")).await;

    move_checkout_head(&setup, "sha2").await;
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        switches(&setup.daemon, "t_a").await.branch.as_deref(),
        Some("feat/x"),
        "the hand commit stays with the owner"
    );
    assert_eq!(switches(&setup.daemon, "t_b").await.branch, None);

    // A task that only turns Running later did not make the hand commit, so
    // it must not take the branch from the owner.
    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Running)
        .await;
    turn_began(&setup, "t_b").await;
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        switches(&setup.daemon, "t_a").await.branch.as_deref(),
        Some("feat/x"),
        "a later-running task does not take the hand commit"
    );
    setup
        .daemon
        .set_task_status("t_b", TaskStatus::Waiting)
        .await;

    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, |r| finished(r) && r.head_sha == "sha2").await;
    assert_eq!(run.task_id, "t_a");
    setup.daemon.shutdown().await;
}

/// Running, as a session whose turn just started: the daemon notes the HEAD
/// it began on.
async fn turn_began(setup: &Setup, task_id: &str) {
    let began = KeeperCommand::TurnBegan {
        task_id: task_id.into(),
    };
    setup.daemon.send(Command::Keepers(began)).await;
    // The HEAD is read off the loop; let that read land before HEAD moves.
    tokio::time::sleep(Duration::from_millis(100)).await;
}

/// A fix held only by another folder session's turn lands once that turn ends.
#[tokio::test]
async fn a_fix_held_by_another_session_lands_when_that_turn_ends() {
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
    until("t_b's turn", || prompts(&setup.fix_log).len() == 1).await;
    wake(&setup, "hello").await;
    loop_event(&mut setup, |s| {
        s.status == KeeperLoopStatus::Waiting && s.reason.as_deref() == Some(SHARED_CHECKOUT_BUSY)
    })
    .await;
    assert!(fix_prompts(&setup).is_empty(), "no fix while t_b works");

    std::fs::write(format!("{}.go", setup.hold.display()), "").unwrap();
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    setup.daemon.shutdown().await;
}
