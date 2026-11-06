//! `when: ready` keepers: started by `keepers.checkReady` only, a draft kept
//! as text, and findings handed to the same fixer as commit keepers'.

use super::checkout::on_branch;
use super::fixer::{fix_prompts, fix_task, state, until};
use super::*;
use crate::daemon::actor::keepers::checkout::NO_BRANCH;
use wire::{KeeperFindingStatus as Status, KeeperOutcome as Outcome};

const SECURITY: &str = "version: 1\npreset: security\nagent: mockkeep\n";
const PR_READY: &str = "version: 1\npreset: pr-ready\nagent: mockkeep\n";

async fn check_ready(setup: &Setup, task_id: &str) -> Result<Vec<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::CheckReady {
        task_id: task_id.into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    rx.await.unwrap()
}

fn go(setup: &Setup, reply: &str) {
    std::fs::write(format!("{}.go", setup.replies.display()), reply).unwrap();
}

/// Only ready keepers that are on start; a running one is not started
/// twice, and one that finished on this HEAD runs again.
#[tokio::test]
async fn check_ready_starts_the_ready_keepers_that_are_on() {
    let intent_off = "version: 1\npreset: intent\nagent: mockkeep\ndefault: off\n";
    let keepers = [
        ("review", REVIEW),
        ("security", SECURITY),
        ("intent", intent_off),
    ];
    let mut setup = setup(&keepers, |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, "WAIT").unwrap();
    assert_eq!(check_ready(&setup, "t_a").await.unwrap(), vec!["security"]);
    let (started, _) = keeper_event(&mut setup, |run| run.checker_task_id.is_some()).await;
    assert_eq!(
        (started.keeper_id.as_str(), started.trigger),
        ("security", wire::KeeperWhen::Ready)
    );
    assert!(check_ready(&setup, "t_a").await.unwrap().is_empty());

    go(&setup, APPROVE);
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(
        (run.outcome, run.head_sha.as_str()),
        (Some(Outcome::Green), "sha1")
    );
    assert_eq!(check_ready(&setup, "t_a").await.unwrap(), vec!["security"]);
    let (again, _) = keeper_event(&mut setup, |run| finished(run) && run.run_number == 2).await;
    assert_eq!(again.head_sha, "sha1", "the same HEAD, checked again");

    let tags: Vec<Vec<String>> = checkers(&setup.daemon)
        .await
        .into_iter()
        .map(|t| t.tags)
        .collect();
    assert_eq!(tags, vec![vec!["keeper:security".to_string()]]);
    assert!(state(&setup)
        .await
        .runs
        .iter()
        .all(|r| r.keeper_id == "security"));
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_poll_or_a_commit_never_starts_a_ready_keeper() {
    let keepers = [("review", REVIEW), ("security", SECURITY)];
    let mut setup = setup(&keepers, |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, APPROVE).unwrap();
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.keeper_id, "review");
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let state = state(&setup).await;
    assert_eq!(state.runs.len(), 1, "{:?}", state.runs);
    assert_eq!(checkers(&setup.daemon).await.len(), 1);
    setup.daemon.shutdown().await;

    let ready_only = self::setup(&[("security", SECURITY)], |wt| vec![task("t_a", Some(wt))]).await;
    commit(&ready_only, "t_a").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(ready_only.script.lock().unwrap().head_reads.is_empty());
    assert!(checkers(&ready_only.daemon).await.is_empty());
    ready_only.daemon.shutdown().await;
}

/// A draft is stored as the run's text and never sent to fix.
#[tokio::test]
async fn a_draft_is_kept_as_text_and_sends_no_fix() {
    let mut setup = setup(&[("pr-ready", PR_READY)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(
        &setup.replies,
        format!("## TL;DR\nAdds the parser.\n{FINDING}"),
    )
    .unwrap();
    assert_eq!(check_ready(&setup, "t_a").await.unwrap(), vec!["pr-ready"]);
    let (run, findings) = keeper_event(&mut setup, finished).await;
    assert_eq!((run.outcome, run.count), (Some(Outcome::Draft), 0));
    let draft = run.draft.unwrap();
    assert!(draft.starts_with("## TL;DR\nAdds the parser."), "{draft}");
    assert!(findings.is_empty(), "a fence in a draft is text");
    let prompt = logged(&setup.log)[2]["prompt"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(prompt.contains("recorded as the draft"), "{prompt}");

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(fix_prompts(&setup).is_empty());
    assert!(!setup.fix_log.exists(), "the task's agent was not woken");
    assert!(state(&setup).await.runs[0].draft.is_some());
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_ready_keepers_findings_reach_the_fixer() {
    let setup = setup(&[("security", SECURITY)], |wt| vec![fix_task("t_a", wt)]).await;
    assert_eq!(check_ready(&setup, "t_a").await.unwrap(), vec!["security"]);
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    assert!(prompt.contains("commit sha1"), "{prompt}");
    assert!(
        prompt.contains("[Security, high] src/lib.rs:4 — panics"),
        "{prompt}"
    );
    let state = state(&setup).await;
    assert!(state.findings.iter().all(|f| f.status == Status::Sent));
    assert_eq!(state.switches.loops["security"].rounds, 1);
    setup.daemon.shutdown().await;
}

/// A folder task checks only its own branch; on the base it is refused
/// with the reason, and an unowned branch is claimed by the request.
#[tokio::test]
async fn a_folder_task_on_the_base_is_refused_with_the_reason() {
    let mut setup = setup(&[("security", SECURITY)], |_| vec![task("t_a", None)]).await;
    on_branch(&setup, None);
    assert_eq!(check_ready(&setup, "t_a").await.unwrap_err(), NO_BRANCH);
    assert!(checkers(&setup.daemon).await.is_empty());

    on_branch(&setup, Some("feat/x"));
    assert_eq!(check_ready(&setup, "t_a").await.unwrap(), vec!["security"]);
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(Outcome::Findings));
    let task = setup
        .daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == "t_a");
    let keepers = task.and_then(|t| t.keepers).unwrap();
    assert_eq!(keepers.branch.as_deref(), Some("feat/x"));
    setup.daemon.shutdown().await;
}
