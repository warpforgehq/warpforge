//! The fixer: keeper findings go as one prompt into the task's own session,
//! and only into a quiet task.

use super::*;
use wire::{KeeperFindingStatus as Status, KeeperLoopStatus};

const HOLD_FIX: &str = "Keepers checked";

pub(super) fn fix_task(id: &str, worktree: &str) -> Task {
    let mut task = task(id, Some(worktree));
    task.agent = "mockfix".into();
    task.session_id = Some("fixer-session-1".into());
    task
}

pub(super) fn reply(findings: &[&str]) -> String {
    let entries: Vec<String> = findings
        .iter()
        .map(|description| {
            format!(
                "{{\"severity\": \"high\", \"file\": \"src/lib.rs\", \"description\": \"{description}\"}}"
            )
        })
        .collect();
    format!(
        "```json\n{{\"verdict\": \"request_changes\", \"findings\": [{}]}}\n```",
        entries.join(", ")
    )
}

pub(super) fn replies(setup: &Setup, entries: &[String]) {
    std::fs::write(&setup.replies, entries.join("\n---\n")).unwrap();
}

/// Start the task's own session with a turn; its end asks for a check.
pub(super) async fn wake(setup: &Setup, text: &str) {
    setup
        .daemon
        .session_prompt("t_a", text, Vec::new())
        .await
        .unwrap();
}

pub(super) fn prompts(log: &Path) -> Vec<String> {
    logged(log)
        .iter()
        .filter_map(|entry| entry["prompt"].as_str().map(str::to_string))
        .collect()
}

pub(super) fn fix_prompts(setup: &Setup) -> Vec<String> {
    let all = prompts(&setup.fix_log);
    all.into_iter().filter(|p| p.contains(HOLD_FIX)).collect()
}

pub(super) async fn until(what: &str, check: impl Fn() -> bool) {
    timeout(Duration::from_secs(20), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

/// `keepers.state` for t_a, with the switches as the daemon keeps them: the
/// reply leaves the saved loops out, and these tests read them.
pub(super) async fn state(setup: &Setup) -> wire::KeeperTaskState {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::State {
        task_id: "t_a".into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    let mut state = rx.await.unwrap().unwrap();
    assert!(state.switches.loops.is_empty(), "loops stay in the daemon");
    let task = setup
        .daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == "t_a");
    state.switches = task.and_then(|t| t.keepers).unwrap_or_default();
    state
}

/// The next `task.keeper` event for `keeper_id` whose loop state satisfies
/// `done`.
pub(super) async fn loop_event_of(
    setup: &mut Setup,
    keeper_id: Option<&str>,
    done: impl Fn(&wire::KeeperLoopState) -> bool,
) -> wire::KeeperLoopState {
    timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(Event::TaskKeeper {
                state,
                keeper_id: id,
                ..
            }) = setup.events.recv().await
            {
                if keeper_id.is_none_or(|wanted| id == wanted) && done(&state) {
                    return state;
                }
            }
        }
    })
    .await
    .expect("a keeper loop event")
}

/// The next `task.keeper` event whose loop state satisfies `done`.
pub(super) async fn loop_event(
    setup: &mut Setup,
    done: impl Fn(&wire::KeeperLoopState) -> bool,
) -> wire::KeeperLoopState {
    loop_event_of(setup, None, done).await
}

async fn poll(setup: &Setup) {
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
}

pub(super) async fn next_commit(setup: &mut Setup, sha: &str) {
    move_head(setup, sha).await;
    commit(setup, "t_a").await;
    keeper_event(setup, |run| run.head_sha == sha && run.outcome.is_some()).await;
}

const SLOP: &str = "version: 1\npreset: slop\nagent: mockkeep\n";

/// Every keeper on one HEAD, merged into one `Keeper` turn; nothing more for
/// that HEAD once it was sent.
#[tokio::test]
async fn findings_of_every_keeper_on_a_head_go_as_one_prompt() {
    let setup = setup(&[("review", REVIEW), ("slop", SLOP)], |wt| {
        vec![fix_task("t_a", wt)]
    })
    .await;
    wake(&setup, "hello").await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    assert!(prompt.contains("commit sha1"), "{prompt}");
    assert!(
        prompt.contains("[Review, high] src/lib.rs:4 — panics"),
        "{prompt}"
    );
    assert!(
        prompt.contains("[Slop, high] src/lib.rs:4 — panics"),
        "{prompt}"
    );
    assert!(prompt.contains("Never use --no-verify. Do not push."));

    wait_idle(&setup.daemon, "t_a").await;
    poll(&setup).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(fix_prompts(&setup).len(), 1, "one prompt per HEAD");
    let state = state(&setup).await;
    assert!(state.findings.iter().all(|f| f.status == Status::Sent));
    for keeper in ["review", "slop"] {
        let fix = &state.switches.loops[keeper];
        assert_eq!((fix.rounds, fix.pending_head.as_deref()), (1, None));
        assert_eq!(state.loops[keeper].status, KeeperLoopStatus::Idle);
    }
    let history = setup.daemon.session_history("t_a".into()).await.unwrap();
    assert!(
        history.iter().any(
            |u| matches!(u, wire::SessionUpdate::KeeperRequest { text } if text.contains(HOLD_FIX))
        ),
        "the transcript says the keepers asked"
    );
    setup.daemon.shutdown().await;
}

/// Invariant 3: a dirty worktree and a working agent both defer the prompt.
#[tokio::test]
async fn no_fix_into_a_dirty_tree_or_a_busy_session() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    let worktree = setup.worktree.clone();
    setup.script.lock().unwrap().dirty.insert(worktree.clone());
    replies(&setup, &["WAIT".into()]);
    wake(&setup, "hello").await;
    keeper_event(&mut setup, |run| run.checker_task_id.is_some()).await;

    std::fs::write(&setup.hold, "HOLDME").unwrap();
    wake(&setup, "HOLDME, keep going").await;
    until("the user's turn", || prompts(&setup.fix_log).len() == 2).await;
    std::fs::write(format!("{}.go", setup.replies.display()), FINDING).unwrap();
    let busy = loop_event(&mut setup, |s| {
        s.status == KeeperLoopStatus::Waiting && s.reason.is_some()
    })
    .await;
    assert_eq!(busy.reason.as_deref(), Some("the task's agent is working"));

    std::fs::write(format!("{}.go", setup.hold.display()), "").unwrap();
    let dirty = loop_event(&mut setup, |s| {
        s.reason.as_deref() == Some("the worktree has uncommitted changes")
    })
    .await;
    assert_eq!(dirty.rounds, 0);
    assert!(fix_prompts(&setup).is_empty());

    setup.script.lock().unwrap().dirty.clear();
    poll(&setup).await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    assert_eq!(state(&setup).await.switches.loops["review"].rounds, 1);
    setup.daemon.shutdown().await;
}

/// The user always wins: a message queues behind the fix turn; force-send
/// cuts it short, which counts no round and reopens its findings.
#[tokio::test]
async fn a_force_send_interrupts_the_fix_without_counting_a_round() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.hold, HOLD_FIX).unwrap();
    wake(&setup, "hello").await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    assert_eq!(state(&setup).await.switches.loops["review"].rounds, 1);

    setup
        .daemon
        .session_prompt("t_a", "the user wins", Vec::new())
        .await
        .unwrap();
    let queued = setup.daemon.tasks().await;
    let queued = queued.iter().find(|t| t.id == "t_a").unwrap();
    assert!(queued.queued_prompts.iter().any(|q| q.initiator == "user"));
    while setup.events.try_recv().is_ok() {}
    setup.daemon.session_interrupt("t_a").await.unwrap();
    let reopened = timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(Event::TaskKeeper {
                state, findings, ..
            }) = setup.events.recv().await
            {
                if state.rounds == 0 {
                    return findings;
                }
            }
        }
    })
    .await
    .expect("the round is given back");
    assert!(
        reopened.iter().all(|f| f.status == Status::Open),
        "{reopened:?}"
    );
    until("the user's turn", || {
        prompts(&setup.fix_log).iter().any(|p| p == "the user wins")
    })
    .await;

    until("the fix sent again", || fix_prompts(&setup).len() == 2).await;
    let again = state(&setup).await;
    assert_eq!(
        again.switches.loops["review"].rounds, 1,
        "the cut turn did not count"
    );
    assert!(logged(&setup.fix_log).iter().any(|e| e["cancel"] == true));

    setup
        .daemon
        .session_prompt("t_a", "after the fix", Vec::new())
        .await
        .unwrap();
    std::fs::write(format!("{}.go", setup.hold.display()), "").unwrap();
    until("the queued message", || {
        prompts(&setup.fix_log).last().map(String::as_str) == Some("after the fix")
    })
    .await;
    let cancels = logged(&setup.fix_log)
        .iter()
        .filter(|e| e["cancel"] == true)
        .count();
    assert_eq!(cancels, 1, "a plain message waits behind the fix turn");
    loop_event(&mut setup, |s| s.status == KeeperLoopStatus::Idle).await;
    setup.daemon.shutdown().await;
}

/// Invariant 5 across a restart: the round handed over before it is sent
/// again and still counts once.
#[tokio::test]
async fn a_restart_re_enters_the_round_without_counting_it_again() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    std::fs::write(&setup.hold, HOLD_FIX).unwrap();
    wake(&setup, "hello").await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let before = state(&setup).await.switches.loops["review"].clone();
    assert_eq!(
        (before.rounds, before.pending_head.as_deref()),
        (1, Some("sha1"))
    );
    setup.daemon.shutdown().await;

    setup.daemon = Daemon::spawn(setup.projects.clone(), Store::open_at(&setup.db).ok());
    setup.events = setup.daemon.subscribe();
    wire_up(&setup).await;
    wake(&setup, "hello again").await;
    until("the resumed turn", || {
        prompts(&setup.fix_log)
            .iter()
            .any(|p| p.ends_with("hello again"))
    })
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    // The resume replay guard reads the first turn's end as history.
    wake(&setup, "and again").await;
    until("the fix sent again", || fix_prompts(&setup).len() == 2).await;
    let after = state(&setup).await;
    assert_eq!(after.switches.loops["review"].rounds, 1);
    assert!(after.findings.iter().all(|f| f.status == Status::Sent));
    std::fs::write(format!("{}.go", setup.hold.display()), "").unwrap();
    setup.daemon.shutdown().await;
}

/// A dismissed finding leaves the fix prompt and goes into the checker's
/// next prompt; a sent one the next run does not report is fixed.
#[tokio::test]
async fn a_dismissed_finding_is_not_sent_and_the_checker_is_told() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![fix_task("t_a", wt)]).await;
    let worktree = setup.worktree.clone();
    setup.script.lock().unwrap().dirty.insert(worktree);
    replies(
        &setup,
        &[reply(&["intended quirk", "real bug"]), APPROVE.into()],
    );
    wake(&setup, "hello").await;
    loop_event(&mut setup, |s| {
        s.status == KeeperLoopStatus::Waiting && s.reason.is_some()
    })
    .await;
    let quirk = state(&setup)
        .await
        .findings
        .into_iter()
        .find(|f| f.description == "intended quirk")
        .unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let dismiss = KeeperCommand::Dismiss {
        task_id: "t_a".into(),
        finding_id: quirk.id.clone(),
        reason: Some("by design".into()),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(dismiss)).await;
    rx.await.unwrap().unwrap();

    setup.script.lock().unwrap().dirty.clear();
    poll(&setup).await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    let prompt = &fix_prompts(&setup)[0];
    assert!(
        prompt.contains("real bug") && !prompt.contains("intended quirk"),
        "{prompt}"
    );
    wait_idle(&setup.daemon, "t_a").await;

    next_commit(&mut setup, "sha2").await;
    let checker_prompts = prompts(&setup.log);
    let second = checker_prompts.last().unwrap();
    assert!(
        second.contains("intended quirk (owner: by design)"),
        "{second}"
    );
    let done = state(&setup).await;
    let status = |text: &str| {
        done.findings
            .iter()
            .find(|f| f.description == text)
            .unwrap()
            .status
    };
    assert_eq!(status("intended quirk"), Status::Dismissed);
    assert_eq!(status("real bug"), Status::Fixed);
    assert_eq!(
        done.switches.loops.get("review"),
        None,
        "green ends the loop"
    );
    setup.daemon.shutdown().await;
}

/// A quota refusal waits and counts no round; the next poll retries.
#[tokio::test]
async fn a_quota_refusal_waits_without_a_round() {
    let mut setup = setup(&[("review", REVIEW)], |wt| {
        let mut task = fix_task("t_a", wt);
        task.account_id = Some("mockfix:work".into());
        vec![task]
    })
    .await;
    let exhausted = vec![crate::daemon::limits::gate::exhausted_row("mockfix")];
    setup
        .daemon
        .send(Command::AgentLimitsUpdated {
            accounts: exhausted,
        })
        .await;
    wake(&setup, "hello").await;
    let refused = loop_event(&mut setup, |s| {
        s.reason.as_deref().is_some_and(|r| r.starts_with("quota"))
    })
    .await;
    assert_eq!(refused.rounds, 0);
    assert!(fix_prompts(&setup).is_empty());

    setup
        .daemon
        .send(Command::AgentLimitsUpdated {
            accounts: Vec::new(),
        })
        .await;
    poll(&setup).await;
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    assert_eq!(state(&setup).await.switches.loops["review"].rounds, 1);
    setup.daemon.shutdown().await;
}

/// Invariant 19: a task with no keeper file gets no keeper turn and no
/// keeper state.
#[tokio::test]
async fn a_task_without_keepers_is_untouched() {
    let mut setup = setup(&[], |wt| vec![fix_task("t_a", wt)]).await;
    wake(&setup, "hello").await;
    wait_idle(&setup.daemon, "t_a").await;
    commit(&setup, "t_a").await;
    poll(&setup).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let heard = prompts(&setup.fix_log);
    assert!(heard.len() == 1 && heard[0].ends_with("hello"), "{heard:?}");
    let tasks = setup.daemon.tasks().await;
    assert_eq!(tasks.iter().find(|t| t.id == "t_a").unwrap().keepers, None);
    while let Ok(event) = setup.events.try_recv() {
        assert!(!matches!(event, Event::TaskKeeper { .. }));
    }
    setup.daemon.shutdown().await;
}

const SLOW_SLOP: &str = "version: 1\npreset: slop\nagent: mockslow\n";

/// While another keeper on the HEAD is still checking, the keeper with
/// findings says it waits for it instead of reading as idle with nothing but
/// **Send to agent**; the prompt goes out once the other keeper answers.
#[tokio::test]
async fn findings_wait_visibly_for_another_keeper_on_the_head() {
    let mut setup = setup(&[("review", REVIEW), ("slop", SLOW_SLOP)], |wt| {
        vec![fix_task("t_a", wt)]
    })
    .await;
    std::fs::write(&setup.slow_replies, "WAIT").unwrap();
    wake(&setup, "hello").await;
    keeper_event(&mut setup, |run| finished(run) && run.keeper_id == "review").await;
    let waiting = loop_event_of(&mut setup, Some("review"), |s| {
        s.status == KeeperLoopStatus::Waiting
    })
    .await;
    assert_eq!(
        waiting.reason.as_deref(),
        Some("Slop is still checking this commit"),
        "the card names the keeper the fix waits for"
    );
    assert!(fix_prompts(&setup).is_empty(), "nothing sent yet");

    std::fs::write(format!("{}.go", setup.slow_replies.display()), APPROVE).unwrap();
    until("the fix prompt", || fix_prompts(&setup).len() == 1).await;
    setup.daemon.shutdown().await;
}
