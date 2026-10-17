//! The journal scope `smith:<id>` (ADR 0027 invariant 7): written only by that
//! Smith's tasks, read by them and the user, never by a plain session.

use serde_json::Value;

use super::*;

async fn memory(daemon: &DaemonHandle, home: &Home) {
    daemon
        .send(Command::Smiths(SmithCommand::UseMemory {
            path: home.root.with_file_name("memory.db"),
        }))
        .await;
}

async fn write(
    daemon: &DaemonHandle,
    scope: &str,
    by: &str,
    content: &str,
) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::MemoryStore {
            content: content.into(),
            scope: Some(scope.into()),
            kind: None,
            tags: None,
            project_id: None,
            created_by: Some(by.into()),
            reply: tx,
        })
        .await;
    rx.await.unwrap().map_err(|e| e.to_string())
}

async fn scopes_seen(daemon: &DaemonHandle, by: Option<&str>) -> Vec<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::MemoryList {
            scope: None,
            kind: None,
            limit: None,
            offset: None,
            task_id: by.map(str::to_string),
            reply: tx,
        })
        .await;
    let listed = rx.await.unwrap().unwrap();
    listed
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["scope"].as_str().unwrap().to_string())
        .collect()
}

fn work_task(id: &str, smith_id: &str) -> Task {
    let mut work = task(id, "demo");
    work.smith = Some(crate::daemon::task::TaskSmith::new(smith_id));
    work
}

#[tokio::test]
async fn only_a_smiths_own_tasks_write_and_read_its_journal() {
    let home = home();
    let daemon = spawn(&home, &[task("t_plain", "demo")]);
    memory(&daemon, &home).await;
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let mut grace = super::ada();
    grace.name = "Grace".into();
    let grace = create(&daemon, grace).await.unwrap().smith;
    let journal = format!("smith:{}", ada.id);
    let other = format!("smith:{}", grace.id);

    assert!(
        write(&daemon, &journal, &ada.thread_task_id, "chose retries")
            .await
            .is_ok()
    );
    let plain = write(&daemon, &journal, "t_plain", "forged")
        .await
        .unwrap_err();
    assert!(plain.contains("only by that Smith"), "{plain}");
    assert!(write(&daemon, &journal, &grace.thread_task_id, "forged")
        .await
        .is_err());
    write(&daemon, &other, &grace.thread_task_id, "grace's note")
        .await
        .unwrap();
    write(&daemon, "global", "t_plain", "shared fact")
        .await
        .unwrap();

    let plain_sees = scopes_seen(&daemon, Some("t_plain")).await;
    assert!(
        plain_sees.iter().all(|s| !s.starts_with("smith:")),
        "{plain_sees:?}"
    );
    let ada_sees = scopes_seen(&daemon, Some(&ada.thread_task_id)).await;
    assert!(
        ada_sees.contains(&journal) && !ada_sees.contains(&other),
        "{ada_sees:?}"
    );
    let user_sees = scopes_seen(&daemon, None).await;
    assert!(
        user_sees.contains(&journal) && user_sees.contains(&other),
        "{user_sees:?}"
    );
}

#[tokio::test]
async fn a_settled_work_session_leaves_one_journal_entry() {
    let home = home();
    let daemon = spawn(&home, &[]);
    memory(&daemon, &home).await;
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let restarted_tasks = [work_task("t_work", &ada.id)];
    flush(&daemon).await;
    let daemon = spawn(&home, &restarted_tasks);
    memory(&daemon, &home).await;

    for _ in 0..2 {
        daemon
            .send(Command::ArchiveTask {
                id: "t_work".into(),
            })
            .await;
    }
    let journal = format!("smith:{}", ada.id);
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::MemoryList {
            scope: Some(journal),
            kind: None,
            limit: None,
            offset: None,
            task_id: None,
            reply: tx,
        })
        .await;
    let entries = rx.await.unwrap().unwrap();
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 1, "{entries:?}");
    assert!(entries[0]["content"]
        .as_str()
        .unwrap()
        .contains("Work session \"work of t_work\" (t_work)"));
    assert_eq!(entries[0]["createdBy"], "daemon");
}

async fn change(
    daemon: &DaemonHandle,
    id: &str,
    by: Option<&str>,
    delete: bool,
) -> Result<(), String> {
    if delete {
        let (tx, rx) = tokio::sync::oneshot::channel();
        daemon
            .send(Command::MemoryDelete {
                id: id.into(),
                task_id: by.map(str::to_string),
                reply: tx,
            })
            .await;
        return rx.await.unwrap().map_err(|e| e.to_string());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::MemoryUpdate {
            id: id.into(),
            content: "rewritten".into(),
            task_id: by.map(str::to_string),
            reply: tx,
        })
        .await;
    rx.await.unwrap().map(|_| ()).map_err(|e| e.to_string())
}

#[tokio::test]
async fn only_the_smith_or_the_user_changes_a_journal_entry() {
    let home = home();
    let daemon = spawn(&home, &[task("t_plain", "demo")]);
    memory(&daemon, &home).await;
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let journal = format!("smith:{}", ada.id);
    let entry = write(&daemon, &journal, &ada.thread_task_id, "chose retries")
        .await
        .unwrap();
    let id = entry["id"].as_str().unwrap().to_string();

    for delete in [false, true] {
        let refused = change(&daemon, &id, Some("t_plain"), delete)
            .await
            .unwrap_err();
        assert!(refused.contains("only by that Smith"), "{refused}");
    }
    change(&daemon, &id, Some(&ada.thread_task_id), false)
        .await
        .unwrap();
    change(&daemon, &id, None, true).await.unwrap();
}

/// Invariant 6 of ADR 0026, for the Smith's half: a turn start with no live
/// session records no delivery.
#[tokio::test]
async fn a_turn_start_with_no_session_moves_no_smith_cursor() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada()).await.unwrap().smith;
    flush(&daemon).await;
    let daemon = spawn(&home, &[work_task("t_work", &ada.id)]);
    daemon
        .send(Command::InjectAcpUpdate {
            task_id: "t_work".into(),
            update: crate::daemon::acp::AcpUpdate::TurnStarted {
                run_id: 0,
                initiator: crate::daemon::acp::TurnInitiator::User,
                echo: None,
                peer: Default::default(),
                smith: Some(crate::daemon::prompt::SmithDelivery {
                    soul_rev: "moved".into(),
                    journal_seen: 99,
                }),
            },
        })
        .await;
    let record = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == "t_work")
        .unwrap()
        .smith
        .unwrap();
    assert_eq!(record.soul_rev, None);
    assert_eq!(record.journal_seen, 0);
}
