use std::collections::{BTreeMap, HashMap};

use warpforge_protocol as wire;
use wire::KeeperFindingStatus as Status;

use super::{load_state, KeeperCommand, KeepersState};
use crate::daemon::actor::{Command, Daemon, DaemonHandle};
use crate::daemon::runtime::Persist;
use crate::daemon::store::{KeeperWrite, Store};
use crate::daemon::task::{Task, TaskStatus};
use crate::registry::ProjectEntry;

fn task(id: &str, project: &str) -> Task {
    let mut task = Task::new(project, &format!("work of {id}"), "claude", vec![]);
    task.id = id.into();
    task.status = TaskStatus::Waiting;
    task
}

fn run(id: &str, task_id: &str, keeper_id: &str) -> wire::KeeperRun {
    wire::KeeperRun {
        id: id.into(),
        task_id: task_id.into(),
        keeper_id: keeper_id.into(),
        run_number: 1,
        trigger: wire::KeeperWhen::Commit,
        head_sha: "abc123".into(),
        base_sha: Some("def456".into()),
        started_at: 100,
        finished_at: Some(160),
        outcome: Some(wire::KeeperOutcome::Findings),
        count: 1,
        checker_task_id: Some("t_checker".into()),
        round: 2,
        cost: Some(wire::SessionUsageCost {
            amount: 0.25,
            currency: "USD".into(),
        }),
        error: None,
        draft: None,
    }
}

fn finding(id: &str, run_id: &str, status: Status) -> wire::KeeperFinding {
    wire::KeeperFinding {
        id: id.into(),
        run_id: run_id.into(),
        key: format!("key-{id}"),
        severity: wire::KeeperSeverity::High,
        file: Some("src/lib.rs".into()),
        line: Some(42),
        description: "breaks on empty input".into(),
        status,
        dismiss_reason: (status == Status::Dismissed).then(|| "intended".to_string()),
        resolved_at: matches!(status, Status::Fixed | Status::Dismissed).then_some(200),
        reply: None,
    }
}

fn tasks(ids: &[&str]) -> HashMap<String, Task> {
    ids.iter()
        .map(|id| (id.to_string(), task(id, "demo")))
        .collect()
}

#[tokio::test]
async fn the_mirror_reads_back_after_the_write_behind_queue() {
    let dir = tempfile::tempdir().unwrap();
    let (persist, store) = Persist::spawn(Some(Store::open_at(&dir.path().join("k.db")).unwrap()));
    let tasks = tasks(&["t_a"]);
    let mut keepers = KeepersState::default();
    let draft = wire::KeeperRun {
        trigger: wire::KeeperWhen::Ready,
        outcome: Some(wire::KeeperOutcome::Draft),
        count: 0,
        draft: Some("## TL;DR\nAdds the parser.".into()),
        ..run("r2", "t_a", "pr-ready")
    };
    keepers.put_run(&persist, &tasks, draft.clone());
    keepers.put_run(&persist, &tasks, run("r1", "t_a", "review"));
    keepers.put_finding(&persist, &tasks, "t_a", finding("f1", "r1", Status::Open));
    keepers.put_finding(&persist, &tasks, "t_a", finding("f1", "r1", Status::Fixed));
    let answered = wire::KeeperFinding {
        reply: Some(wire::KeeperReply {
            verdict: wire::KeeperReplyVerdict::Stale,
            reason: "fixed in abc".into(),
        }),
        ..finding("f2", "r1", Status::Sent)
    };
    keepers.put_finding(&persist, &tasks, "t_a", answered.clone());
    persist.flush().await;

    let reloaded = load_state(store.as_ref());
    let state = reloaded.task("t_a").unwrap();
    assert_eq!(Some(state), keepers.task("t_a"));
    assert_eq!(state.runs, vec![draft, run("r1", "t_a", "review")]);
    assert_eq!(
        state.findings,
        vec![finding("f1", "r1", Status::Fixed), answered]
    );
}

#[tokio::test]
async fn writes_for_a_gone_task_or_an_unknown_run_are_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let (persist, store) = Persist::spawn(Some(Store::open_at(&dir.path().join("k.db")).unwrap()));
    let mut keepers = KeepersState::default();
    keepers.put_run(&persist, &tasks(&[]), run("r1", "t_gone", "review"));
    keepers.put_run(&persist, &tasks(&["t_a"]), run("r2", "t_a", "review"));
    keepers.put_finding(
        &persist,
        &tasks(&["t_a"]),
        "t_a",
        finding("f1", "r_other", Status::Open),
    );
    keepers.forget_task("t_a");
    keepers.put_finding(
        &persist,
        &tasks(&[]),
        "t_a",
        finding("f2", "r2", Status::Open),
    );
    persist.flush().await;

    assert!(keepers.task("t_gone").is_none());
    let reloaded = load_state(store.as_ref());
    assert!(reloaded.task("t_gone").is_none());
    assert!(reloaded.task("t_a").unwrap().findings.is_empty());
}

fn seed(store: &Store, task_id: &str, run_id: &str, status: Status) {
    for write in [
        KeeperWrite::Run(Box::new(run(run_id, task_id, "review"))),
        KeeperWrite::Finding(Box::new(finding(&format!("f_{run_id}"), run_id, status))),
    ] {
        store.apply_keeper_write(&write).unwrap();
    }
}

#[test]
fn deleting_a_task_deletes_only_its_keeper_rows() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    for id in ["t_a", "t_b"] {
        store.upsert_task(&task(id, "demo")).unwrap();
    }
    seed(&store, "t_a", "r_a", Status::Open);
    seed(&store, "t_b", "r_b", Status::Fixed);

    store.delete_task("t_a").unwrap();

    let loaded = store.load_keeper_state().unwrap();
    assert!(!loaded.contains_key("t_a"));
    assert_eq!(loaded["t_b"].findings.len(), 1);
}

#[test]
fn task_switches_round_trip_and_default_to_none() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let mut switched = task("t_a", "demo");
    switched.keepers = Some(wire::TaskKeepers {
        overrides: BTreeMap::from([("review".to_string(), false)]),
        loops: BTreeMap::from([(
            "slop".to_string(),
            wire::KeeperLoop {
                rounds: 2,
                round_head: Some("abc".into()),
                stop: Some(wire::KeeperStop::NoProgress),
                ..Default::default()
            },
        )]),
        branch: Some("feat/x".into()),
        held: None,
        head: None,
    });
    store.upsert_task(&switched).unwrap();
    store.upsert_task(&task("t_b", "demo")).unwrap();

    let loaded: HashMap<String, Task> = store
        .load_tasks()
        .unwrap()
        .into_iter()
        .map(|task| (task.id.clone(), task))
        .collect();
    assert_eq!(loaded["t_a"].keepers, switched.keepers);
    assert_eq!(loaded["t_b"].keepers, None);
}

fn projects() -> Vec<ProjectEntry> {
    ["demo", "other"]
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

async fn state(daemon: &DaemonHandle, task_id: &str) -> Result<wire::KeeperTaskState, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Keepers(KeeperCommand::State {
            task_id: task_id.into(),
            reply: tx,
        }))
        .await;
    rx.await.unwrap()
}

#[tokio::test]
async fn keepers_state_serves_the_mirror_loaded_at_spawn_until_the_task_is_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("warpforge.db");
    let store = Store::open_at(&db).unwrap();
    let mut a = task("t_a", "demo");
    a.keepers = Some(wire::TaskKeepers {
        overrides: BTreeMap::from([("slop".to_string(), true)]),
        ..Default::default()
    });
    store.upsert_task(&a).unwrap();
    store.upsert_task(&task("t_b", "demo")).unwrap();
    store.upsert_task(&task("t_c", "other")).unwrap();
    store.upsert_task(&task("t_plain", "demo")).unwrap();
    seed(&store, "t_a", "r_a", Status::Fixed);
    seed(&store, "t_b", "r_b", Status::Dismissed);
    seed(&store, "t_c", "r_c", Status::Fixed);
    let daemon = Daemon::spawn(projects(), Some(store));

    let reply = state(&daemon, "t_a").await.unwrap();
    assert_eq!(reply.switches, a.keepers.clone().unwrap());
    assert_eq!(reply.runs, vec![run("r_a", "t_a", "review")]);
    assert_eq!(reply.findings.len(), 1);
    assert_eq!(
        reply.precision,
        vec![wire::KeeperPrecision {
            keeper_id: "review".into(),
            fixed: 1,
            dismissed: 1,
        }]
    );

    let plain = state(&daemon, "t_plain").await.unwrap();
    assert!(plain.runs.is_empty() && plain.findings.is_empty());
    assert_eq!(plain.switches, wire::TaskKeepers::default());
    assert!(state(&daemon, "t_missing").await.is_err());

    daemon.delete_task("t_a").await.unwrap();
    assert!(state(&daemon, "t_a").await.is_err());
    let after = Store::open_at(&db).unwrap().load_keeper_state().unwrap();
    assert!(!after.contains_key("t_a"));
    assert!(after.contains_key("t_b"));
}
