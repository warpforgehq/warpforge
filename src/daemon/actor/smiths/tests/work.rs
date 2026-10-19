//! `start_work` and the board (ADR 0027): the daemon's limits, the report back
//! to the asker, and assignment that starts nothing.

use super::sessions::{ada_on, agent, prompt_texts, wait, wait_idle};
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

const CHANNEL_AGENT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-channel.mjs"
);

/// A Smith on the channel mock, which answers "<name> ok <turn> <pid>" and
/// holds a turn open while `gate` exists.
async fn smith_on_mock(
    daemon: &DaemonHandle,
    home: &Home,
    name: &str,
    gate: Option<&Path>,
) -> (wire::Smith, PathBuf) {
    let log = home._dir.path().join(format!("{name}.log"));
    let gate = gate
        .map(|g| format!(" {}", g.display()))
        .unwrap_or_default();
    let mut spec = ada();
    spec.name = name.into();
    spec.agent = format!("node {CHANNEL_AGENT} {} {name}{gate}", log.display());
    (create(daemon, spec).await.unwrap().smith, log)
}

async fn records_from(daemon: &DaemonHandle, task_id: &str) -> Vec<wire::PeerMessage> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Feed {
            project: None,
            before: None,
            limit: None,
            channel: None,
            reply: tx,
        }))
        .await;
    rx.await
        .unwrap()
        .unwrap()
        .into_iter()
        .filter(|m| m.from_task.as_deref() == Some(task_id))
        .collect()
}

#[tokio::test]
async fn every_finished_turn_of_a_started_session_wakes_the_asker_with_its_report() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let (ada, ada_log) = smith_on_mock(&daemon, &home, "Ada", None).await;
    let (_bo, _) = smith_on_mock(&daemon, &home, "Bo", None).await;
    let thread = ada.thread_task_id.clone();
    let work = start_from(&daemon, &thread, "Bo", "demo").await.unwrap();

    let log = ada_log.clone();
    wait("the asker woken by the first report", || {
        prompt_texts(&log).iter().any(|p| p.contains("Bo ok 1"))
    })
    .await;
    let first = prompt_texts(&ada_log)
        .into_iter()
        .find(|p| p.contains("Bo ok 1"))
        .unwrap();
    assert!(first.contains("reported back"), "{first}");
    assert!(
        first.contains("Work session \"fix the login flake\""),
        "{first}"
    );
    wait_idle(&daemon, &thread).await;
    let listed = peers_of(&daemon, &thread).await;
    assert!(
        listed.iter().any(|p| p.id == work && p.started),
        "the asker sees what it started: {listed:?}"
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Message {
            from_task_id: thread.clone(),
            to: work.clone(),
            message: "status?".into(),
            reply: tx,
        }))
        .await;
    rx.await.unwrap().unwrap();
    wait("the reply to the ping, reported too", || {
        prompt_texts(&log).iter().any(|p| p.contains("Bo ok 2"))
    })
    .await;
    wait_idle(&daemon, &thread).await;

    for _ in 0..2 {
        daemon.send(Command::ArchiveTask { id: work.clone() }).await;
    }
    let reports = records_from(&daemon, &work).await;
    assert_eq!(
        reports.len(),
        2,
        "one per turn, none on settle: {reports:?}"
    );
    assert!(reports
        .iter()
        .all(|r| r.to_task.as_deref() == Some(thread.as_str())
            && r.status == wire::PeerMessageStatus::Delivered));
}

#[tokio::test]
async fn a_busy_asker_hears_the_report_once_its_turn_ends() {
    let home = home();
    let gate = home._dir.path().join("gate");
    std::fs::write(&gate, "").unwrap();
    let daemon = spawn(&home, &[]);
    let (ada, ada_log) = smith_on_mock(&daemon, &home, "Ada", Some(&gate)).await;
    let (_bo, bo_log) = smith_on_mock(&daemon, &home, "Bo", None).await;
    let thread = ada.thread_task_id.clone();
    daemon
        .session_prompt(&thread, "think about it", vec![])
        .await
        .unwrap();
    let log = ada_log.clone();
    wait("the asker busy", || prompt_texts(&log).len() == 1).await;

    start_from(&daemon, &thread, "Bo", "demo").await.unwrap();
    let bo = bo_log.clone();
    wait("the work session's turn", || !prompt_texts(&bo).is_empty()).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(
        prompt_texts(&ada_log).len(),
        1,
        "nothing while the asker is busy"
    );

    std::fs::remove_file(&gate).unwrap();
    wait("the report after the asker's turn", || {
        prompt_texts(&log).iter().any(|p| p.contains("Bo ok 1"))
    })
    .await;
}

#[tokio::test]
async fn a_smith_led_orchestrator_hears_its_started_session_report() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let (ada, ada_log) = smith_on_mock(&daemon, &home, "Ada", None).await;
    let (_bo, _) = smith_on_mock(&daemon, &home, "Bo", None).await;
    let lead = ask(&daemon, |reply| SmithCommand::StartWork {
        id: ada.id.clone(),
        project: "demo".into(),
        brief: "lead the migration".into(),
        backlog_item_id: None,
        worktree: false,
        orchestrator: true,
        reply,
    })
    .await
    .unwrap();
    wait_idle(&daemon, &lead).await;
    start_from(&daemon, &lead, "Bo", "demo").await.unwrap();
    let log = ada_log.clone();
    wait("the lead woken by the report", || {
        prompt_texts(&log)
            .iter()
            .any(|p| p.contains("Bo ok 1") && p.contains("reported back"))
    })
    .await;
}

#[tokio::test]
async fn a_turn_that_already_messaged_its_asker_sends_no_report() {
    let home = home();
    let gate = home._dir.path().join("gate");
    std::fs::write(&gate, "").unwrap();
    let daemon = spawn(&home, &[]);
    let (ada, _) = smith_on_mock(&daemon, &home, "Ada", None).await;
    let (_bo, bo_log) = smith_on_mock(&daemon, &home, "Bo", Some(&gate)).await;
    let thread = ada.thread_task_id.clone();
    let work = start_from(&daemon, &thread, "Bo", "demo").await.unwrap();
    let bo = bo_log.clone();
    wait("the work session's turn", || !prompt_texts(&bo).is_empty()).await;

    // What message_agent from inside the running turn sends.
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Message {
            from_task_id: work.clone(),
            to: thread.clone(),
            message: "PING-REPLY-OK".into(),
            reply: tx,
        }))
        .await;
    rx.await.unwrap().unwrap();
    std::fs::remove_file(&gate).unwrap();
    wait_idle(&daemon, &work).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let records = records_from(&daemon, &work).await;
    assert_eq!(records.len(), 1, "the message, no report: {records:?}");
    assert_eq!(records[0].text, "PING-REPLY-OK");

    wait_idle(&daemon, &thread).await;
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Message {
            from_task_id: thread.clone(),
            to: work.clone(),
            message: "anything else?".into(),
            reply: tx,
        }))
        .await;
    rx.await.unwrap().unwrap();
    wait("the next turn, reported", || prompt_texts(&bo).len() == 2).await;
    wait_idle(&daemon, &work).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let records = records_from(&daemon, &work).await;
    assert_eq!(records.len(), 2, "{records:?}");
    assert!(
        records.iter().any(|r| r.text.contains("finished a turn")),
        "{records:?}"
    );
}

#[tokio::test]
async fn a_report_keeps_who_sent_it_after_the_session_is_deleted() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let (ada, _) = smith_on_mock(&daemon, &home, "Ada", None).await;
    let (bo, _) = smith_on_mock(&daemon, &home, "Bo", None).await;
    let thread = ada.thread_task_id.clone();
    let work = start_from(&daemon, &thread, "Bo", "demo").await.unwrap();
    wait_idle(&daemon, &work).await;
    wait_idle(&daemon, &thread).await;

    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::DeleteTask {
            id: work.clone(),
            reply: tx,
        })
        .await;
    rx.await.unwrap().unwrap();
    let reports = records_from(&daemon, &work).await;
    let report = reports.first().expect("the report");
    assert_eq!(
        report.from_label.as_deref(),
        Some("Bo · fix the login flake")
    );
    assert_eq!(report.to_label.as_deref(), Some("Ada"));
    assert_eq!(report.from_smith_id.as_deref(), Some(bo.id.as_str()));
    assert_eq!(report.to_smith_id.as_deref(), Some(ada.id.as_str()));
}

#[tokio::test]
async fn a_muted_asker_is_not_woken_and_the_report_stays_held() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let (ada, ada_log) = smith_on_mock(&daemon, &home, "Ada", None).await;
    let (_bo, bo_log) = smith_on_mock(&daemon, &home, "Bo", None).await;
    let thread = ada.thread_task_id.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::SetMuted {
            task_id: thread.clone(),
            muted: true,
            reply: tx,
        }))
        .await;
    rx.await.unwrap().unwrap();
    let work = start_from(&daemon, &thread, "Bo", "demo").await.unwrap();
    let bo = bo_log.clone();
    wait("the work session's turn", || !prompt_texts(&bo).is_empty()).await;
    wait_idle(&daemon, &work).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    assert!(
        prompt_texts(&ada_log).is_empty(),
        "no nudge to a muted asker"
    );
    let reports = records_from(&daemon, &work).await;
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].status, wire::PeerMessageStatus::Held);
}
