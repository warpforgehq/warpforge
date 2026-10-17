//! `start_work` and the board (ADR 0027): the daemon's limits, the report back
//! to the asker, and assignment that starts nothing.

use super::sessions::{ada_on, agent, wait_idle};
use super::*;

const WRITER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-writer.mjs"
);

async fn start_from(
    daemon: &DaemonHandle,
    from: &str,
    target: &str,
    project: &str,
) -> Result<String, String> {
    ask(daemon, |reply| SmithCommand::StartWorkFrom {
        from: from.into(),
        target: target.into(),
        project: project.into(),
        brief: "fix the login flake".into(),
        backlog_item_id: None,
        worktree: false,
        reply,
    })
    .await
    .map(|(task_id, _)| task_id)
}

async fn task_of(daemon: &DaemonHandle, id: &str) -> Task {
    daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .expect("the task")
}

#[tokio::test]
async fn start_work_keeps_to_the_depth_and_open_session_limits() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[task("t_plain", "demo")]);
    let ada = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let thread = ada.thread_task_id.clone();

    let plain = start_from(&daemon, "t_plain", "self", "demo")
        .await
        .unwrap_err();
    assert!(plain.contains("for a Smith's own sessions"), "{plain}");
    let far = start_from(&daemon, &thread, "self", "third")
        .await
        .unwrap_err();
    assert!(far.contains("may not work in third"), "{far}");
    let nobody = start_from(&daemon, &thread, "Nobody", "demo")
        .await
        .unwrap_err();
    assert!(nobody.contains("no Smith is called Nobody"), "{nobody}");

    let first = start_from(&daemon, &thread, "self", "demo").await.unwrap();
    let record = task_of(&daemon, &first).await.smith.unwrap();
    assert_eq!(record.depth, 1);
    assert_eq!(record.report_to.as_deref(), Some(thread.as_str()));
    let second = start_from(&daemon, &first, "Ada", "other").await.unwrap();
    assert_eq!(task_of(&daemon, &second).await.smith.unwrap().depth, 2);
    let deep = start_from(&daemon, &second, "self", "demo")
        .await
        .unwrap_err();
    assert!(deep.contains("cannot start more"), "{deep}");

    start_from(&daemon, &thread, "self", "demo").await.unwrap();
    let crowded = start_from(&daemon, &thread, "self", "demo")
        .await
        .unwrap_err();
    assert!(crowded.contains("3 open work sessions"), "{crowded}");
}

#[tokio::test]
async fn a_held_or_spent_smith_starts_no_work() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let mut spec = ada_on(&agent);
    spec.budget = Some(wire::SmithBudget {
        usd_per_day: None,
        turns_per_day: Some(1),
    });
    let ada = create(&daemon, spec).await.unwrap().smith;
    let thread = ada.thread_task_id.clone();

    let work = start_from(&daemon, &thread, "self", "demo").await.unwrap();
    wait_idle(&daemon, &work).await;
    let spent = start_from(&daemon, &thread, "self", "demo")
        .await
        .unwrap_err();
    assert!(spent.contains("daily limit"), "{spent}");

    ask(&daemon, |reply| SmithCommand::Update {
        id: ada.id.clone(),
        patch: Box::new(wire::SmithPatch {
            budget: Some(wire::SmithBudget::default()),
            ..Default::default()
        }),
        reply,
    })
    .await
    .unwrap();
    ask(&daemon, |reply| SmithCommand::SetPaused {
        id: ada.id.clone(),
        paused: true,
        reply,
    })
    .await
    .unwrap();
    let paused = start_from(&daemon, &thread, "self", "demo")
        .await
        .unwrap_err();
    assert!(paused.contains("held"), "{paused}");
}

#[tokio::test]
async fn a_settled_work_session_reports_back_to_the_asker_once() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let thread = ada.thread_task_id.clone();
    let work = start_from(&daemon, &thread, "self", "demo").await.unwrap();
    wait_idle(&daemon, &work).await;

    for _ in 0..2 {
        daemon.send(Command::ArchiveTask { id: work.clone() }).await;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Feed {
            project: None,
            before: None,
            limit: None,
            reply: tx,
        }))
        .await;
    let reports: Vec<wire::PeerMessage> = rx
        .await
        .unwrap()
        .unwrap()
        .into_iter()
        .filter(|m| m.from_task.as_deref() == Some(work.as_str()))
        .collect();
    assert_eq!(reports.len(), 1, "{reports:?}");
    let report = &reports[0];
    assert_eq!(report.to_task.as_deref(), Some(thread.as_str()));
    assert_eq!(
        report.status,
        wire::PeerMessageStatus::Held,
        "it wakes nobody"
    );
    assert!(
        report.text.contains("Work session \"fix the login flake\""),
        "{}",
        report.text
    );
    assert!(
        report.text.contains("Closing message: OK"),
        "{}",
        report.text
    );
}
