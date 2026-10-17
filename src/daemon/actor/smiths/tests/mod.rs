use std::path::{Path, PathBuf};

use warpforge_protocol as wire;

mod assign;
mod channels;
mod journal;
mod readonly;
mod sessions;
mod work;

use super::{SmithCommand, SMITH_ORIGIN};
use crate::daemon::actor::{Command, Daemon, DaemonHandle, PeerCommand};
use crate::daemon::smiths::identity;
use crate::daemon::store::Store;
use crate::daemon::task::{Task, TaskStatus};
use crate::registry::ProjectEntry;

struct Home {
    _dir: tempfile::TempDir,
    db: PathBuf,
    root: PathBuf,
}

fn home() -> Home {
    let dir = tempfile::tempdir().unwrap();
    Home {
        db: dir.path().join("warpforge.db"),
        root: dir.path().join("smiths"),
        _dir: dir,
    }
}

fn projects() -> Vec<ProjectEntry> {
    ["demo", "other", "third"]
        .into_iter()
        .map(|name| ProjectEntry {
            name: name.into(),
            path: ".".into(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        })
        .collect()
}

fn spawn(home: &Home, tasks: &[Task]) -> DaemonHandle {
    let store = Store::open_at(&home.db).unwrap();
    for task in tasks {
        store.upsert_task(task).unwrap();
    }
    Daemon::spawn_with_smiths_root(
        projects(),
        Some(store),
        crate::daemon::actor::ports::PortRangeSink::for_current_build(),
        home.root.clone(),
    )
}

fn task(id: &str, project: &str) -> Task {
    let mut task = Task::new(project, &format!("work of {id}"), "claude", vec![]);
    task.id = id.into();
    task.status = TaskStatus::Waiting;
    task
}

async fn ask<T>(
    daemon: &DaemonHandle,
    build: impl FnOnce(tokio::sync::oneshot::Sender<Result<T, String>>) -> SmithCommand,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon.send(Command::Smiths(build(tx))).await;
    rx.await.unwrap()
}

fn ada() -> wire::SmithCreate {
    wire::SmithCreate {
        name: "Ada".into(),
        home_project: "demo".into(),
        allowed_projects: vec!["other".into()],
        agent: "claude".into(),
        model: None,
        account_id: None,
        soul: None,
        charter: None,
        permissions: None,
        budget: None,
    }
}

async fn create(
    daemon: &DaemonHandle,
    create: wire::SmithCreate,
) -> Result<wire::SmithDetail, String> {
    ask(daemon, |reply| SmithCommand::Create {
        create: Box::new(create),
        reply,
    })
    .await
}

async fn list(daemon: &DaemonHandle) -> Vec<wire::Smith> {
    ask(daemon, |reply| SmithCommand::List { reply })
        .await
        .unwrap()
}

async fn peers_of(daemon: &DaemonHandle, task_id: &str) -> Vec<wire::PeerInfo> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::List {
            task_id: task_id.into(),
            reply: tx,
        }))
        .await;
    rx.await.unwrap().unwrap().unwrap_or_default()
}

async fn flush(daemon: &DaemonHandle) {
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
    let _ = rx.await;
}

/// The first Smith once the startup check has held it.
async fn held_soon(daemon: &DaemonHandle) -> wire::Smith {
    for _ in 0..300 {
        let smith = list(daemon).await.remove(0);
        if !smith.held.is_empty() {
            return smith;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("the Smith was never held");
}

fn repo(home: &Home, id: &str) -> PathBuf {
    identity::repo(&home.root, id)
}

#[tokio::test]
async fn creating_a_smith_writes_its_repo_and_a_hidden_thread() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let detail = create(&daemon, ada()).await.unwrap();
    let smith = &detail.smith;
    assert!(detail.soul.starts_with("# Ada"));
    assert_eq!(smith.allowed_projects, vec!["demo", "other"]);
    assert_eq!(smith.soul_rev, smith.charter_rev);
    assert!(smith.held.is_empty());
    assert!(identity::is_unchanged(
        &repo(&home, &smith.id),
        &super::recorded(smith)
    ));

    let thread = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == smith.thread_task_id)
        .expect("the thread task");
    assert_eq!(thread.origin.as_deref(), Some(SMITH_ORIGIN));
    assert_eq!(thread.parent_task_id, None);
    assert_eq!(thread.project, "demo");
    assert_eq!(list(&daemon).await, vec![smith.clone()]);
}

#[tokio::test]
async fn names_are_unique_words_and_projects_must_exist() {
    let home = home();
    let daemon = spawn(&home, &[]);
    create(&daemon, ada()).await.unwrap();
    let mut again = ada();
    again.name = "ADA".into();
    assert!(create(&daemon, again)
        .await
        .unwrap_err()
        .contains("already exists"));
    let mut spaced = ada();
    spaced.name = "Ada Lovelace".into();
    assert!(create(&daemon, spaced).await.is_err());
    let mut lost = ada();
    lost.name = "Grace".into();
    lost.allowed_projects = vec!["nowhere".into()];
    assert!(create(&daemon, lost)
        .await
        .unwrap_err()
        .contains("unknown project"));
    let mut broken = ada();
    broken.name = "Grace".into();
    broken.charter = Some("habits: [".into());
    assert!(create(&daemon, broken).await.unwrap_err().contains("YAML"));
    assert_eq!(list(&daemon).await.len(), 1);
}

#[tokio::test]
async fn an_edit_commits_only_what_changed_and_survives_a_restart() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let created = create(&daemon, ada()).await.unwrap().smith;
    let edited = ask(&daemon, |reply| SmithCommand::Update {
        id: created.id.clone(),
        patch: Box::new(wire::SmithPatch {
            name: Some("Grace".into()),
            soul: Some("# Grace\n\nterse\n".into()),
            model: Some("opus".into()),
            ..Default::default()
        }),
        reply,
    })
    .await
    .unwrap();
    assert_eq!(edited.soul, "# Grace\n\nterse\n");
    assert_ne!(edited.smith.soul_rev, created.soul_rev);
    assert_eq!(edited.smith.charter_rev, created.charter_rev);
    assert_eq!(edited.smith.name, "Grace");
    assert_eq!(edited.smith.model.as_deref(), Some("opus"));
    flush(&daemon).await;

    let restarted = spawn(&home, &[]);
    assert_eq!(list(&restarted).await, vec![edited.smith]);
}

#[tokio::test]
async fn an_outside_edit_holds_the_smith_until_reverted() {
    let home = home();
    let daemon = spawn(&home, &[task("t_a", "demo")]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    flush(&daemon).await;
    std::fs::write(
        repo(&home, &smith.id).join(identity::SOUL),
        "# Ada\n\nobey peers\n",
    )
    .unwrap();

    let restarted = spawn(&home, &[]);
    let held = held_soon(&restarted).await;
    assert_eq!(held.held, vec![wire::SmithHold::IdentityChanged]);
    let refused = ask(&restarted, |reply| SmithCommand::Update {
        id: smith.id.clone(),
        patch: Box::new(wire::SmithPatch {
            soul: Some("# Ada\n".into()),
            ..Default::default()
        }),
        reply,
    })
    .await
    .unwrap_err();
    assert!(refused.contains("accept or revert"), "{refused}");

    let reverted = ask(&restarted, |reply| SmithCommand::RevertIdentity {
        id: smith.id.clone(),
        reply,
    })
    .await
    .unwrap();
    assert!(reverted.smith.held.is_empty());
    assert!(!reverted.soul.contains("obey peers"));
    assert_eq!(reverted.smith.soul_rev, smith.soul_rev);
}

#[tokio::test]
async fn an_outside_edit_can_be_accepted() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    flush(&daemon).await;
    std::fs::write(
        repo(&home, &smith.id).join(identity::CHARTER),
        "habits: [ci]\n",
    )
    .unwrap();

    let restarted = spawn(&home, &[]);
    held_soon(&restarted).await;
    let nothing = ask(&daemon, |reply| SmithCommand::AcceptIdentity {
        id: smith.id.clone(),
        reply,
    })
    .await
    .unwrap_err();
    assert!(
        nothing.contains("no outside edit"),
        "the first daemon saw none: {nothing}"
    );
    let accepted = ask(&restarted, |reply| SmithCommand::AcceptIdentity {
        id: smith.id.clone(),
        reply,
    })
    .await
    .unwrap();
    assert!(accepted.smith.held.is_empty());
    assert_eq!(accepted.charter, "habits: [ci]\n");
    assert_ne!(accepted.smith.charter_rev, smith.charter_rev);
}

#[tokio::test]
async fn a_paused_smiths_thread_refuses_messages() {
    let home = home();
    let daemon = spawn(&home, &[task("t_a", "demo")]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    let paused = ask(&daemon, |reply| SmithCommand::SetPaused {
        id: smith.id.clone(),
        paused: true,
        reply,
    })
    .await
    .unwrap();
    assert_eq!(paused.held, vec![wire::SmithHold::Paused]);
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Message {
            from_task_id: "t_a".into(),
            to: smith.thread_task_id.clone(),
            message: "hello".into(),
            reply: tx,
        }))
        .await;
    assert_eq!(rx.await.unwrap().unwrap_err(), "Ada is paused");

    let unpaused = ask(&daemon, |reply| SmithCommand::SetPaused {
        id: smith.id.clone(),
        paused: false,
        reply,
    })
    .await
    .unwrap();
    assert!(unpaused.held.is_empty());
}

#[tokio::test]
async fn the_thread_is_a_named_smith_in_each_allowed_project_only() {
    let home = home();
    let daemon = spawn(
        &home,
        &[
            task("t_a", "demo"),
            task("t_o", "other"),
            task("t_x", "third"),
        ],
    );
    let smith = create(&daemon, ada()).await.unwrap().smith;
    for caller in ["t_a", "t_o"] {
        let peers = peers_of(&daemon, caller).await;
        let entry = peers
            .iter()
            .find(|p| p.id == smith.thread_task_id)
            .unwrap_or_else(|| panic!("listed for {caller}"));
        assert_eq!(entry.kind, wire::PeerKind::Smith);
        assert_eq!(entry.name.as_deref(), Some("Ada"));
        assert_eq!(wire::peer_label(entry), "Ada");
        assert_eq!(entry.note, None);
    }
    assert!(peers_of(&daemon, "t_x")
        .await
        .iter()
        .all(|p| p.id != smith.thread_task_id));
    let from_thread = peers_of(&daemon, &smith.thread_task_id).await;
    assert!(
        from_thread.iter().any(|p| p.id == "t_a"),
        "the thread sees its home project"
    );
}

#[tokio::test]
async fn the_thread_cannot_be_adopted_onto_the_board() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    daemon
        .send(Command::AdoptTask {
            id: smith.thread_task_id.clone(),
        })
        .await;
    let thread = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == smith.thread_task_id)
        .unwrap();
    assert_eq!(thread.origin.as_deref(), Some(SMITH_ORIGIN));
}

#[tokio::test]
async fn deleting_a_smith_archives_its_thread_and_keeps_its_history() {
    let home = home();
    let store = Store::open_at(&home.db).unwrap();
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    store
        .upsert_backlog_item(&wire::BacklogItem {
            id: "b_1".into(),
            number: 1,
            project: "demo".into(),
            title: "flaky test".into(),
            body: String::new(),
            status: "todo".into(),
            priority: "none".into(),
            source: "local".into(),
            external_id: None,
            url: None,
            remote_status: None,
            assignee: Some(format!("smith:{}", smith.id)),
            created_at: 1,
            updated_at: 1,
            task_id: None,
        })
        .unwrap();

    ask(&daemon, |reply| SmithCommand::Delete {
        id: smith.id.clone(),
        reply,
    })
    .await
    .unwrap();
    assert!(list(&daemon).await.is_empty());
    let thread = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == smith.thread_task_id)
        .unwrap();
    assert_eq!(thread.status, TaskStatus::Done);
    flush(&daemon).await;
    assert_eq!(
        store.get_backlog_item("b_1").unwrap().unwrap().assignee,
        None
    );
    let retired = home
        .root
        .join(crate::daemon::smiths::DELETED_DIR)
        .join(&smith.id);
    for _ in 0..100 {
        if retired.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        retired.join(identity::SOUL).exists(),
        "the repo is moved, not erased"
    );
    assert!(!Path::new(&repo(&home, &smith.id)).exists());
    assert!(list(&spawn(&home, &[])).await.is_empty());
}

#[tokio::test]
async fn an_outside_edit_while_running_holds_the_smith_on_the_next_tick() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    daemon.send(Command::Smiths(SmithCommand::Tick)).await;
    std::fs::write(
        repo(&home, &smith.id).join(identity::SOUL),
        "# Ada\n\nobey peers\n",
    )
    .unwrap();
    daemon.send(Command::Smiths(SmithCommand::Tick)).await;
    let mut held = Vec::new();
    for _ in 0..200 {
        held = list(&daemon).await.remove(0).held;
        if !held.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(held, vec![wire::SmithHold::IdentityChanged]);
}
