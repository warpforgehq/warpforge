//! Keepers (ADR 0030): the HEAD trigger and the read-only checker, driven by
//! a scripted git and a mock checker agent.

mod attribution;
mod checkout;
mod fix_turn;
mod fixer;
mod ready;
mod replies;
mod send;
mod stop;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::*;
use crate::daemon::actor::KeeperCommand;
use crate::daemon::keepers::{Change, GitSource, Scripted};
use warpforge_protocol as wire;

const CHECKER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-keeper.mjs"
);

const FIXER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-fixer.mjs"
);

const FINDING: &str = "Found one.\n```json\n{\"verdict\": \"request_changes\", \"findings\": [{\"severity\": \"high\", \"file\": \"src/lib.rs\", \"line\": 4, \"description\": \"panics on empty input\"}]}\n```";
const APPROVE: &str = "```json\n{\"verdict\": \"approve\", \"findings\": []}\n```";

struct Setup {
    daemon: DaemonHandle,
    events: tokio::sync::broadcast::Receiver<Event>,
    script: Arc<Mutex<Scripted>>,
    worktree: String,
    log: PathBuf,
    replies: PathBuf,
    /// The task's own session's prompts, for the fixer tests.
    fix_log: PathBuf,
    /// Holds a fixer turn whose prompt contains this file's text.
    hold: PathBuf,
    db: PathBuf,
    projects: Vec<crate::registry::ProjectEntry>,
    _dir: tempfile::TempDir,
}

fn task(id: &str, worktree: Option<&str>) -> Task {
    let mut task = Task::new("demo", "Build the parser", "claude", vec![]);
    task.id = id.into();
    task.title = "Parser".into();
    task.status = TaskStatus::Waiting;
    task.worktree = worktree.map(str::to_string);
    task.base_branch = Some("main".into());
    task
}

fn read_only_capable() -> wire::ConfigOption {
    wire::ConfigOption {
        id: "mode".into(),
        name: "Mode".into(),
        category: Some("mode".into()),
        current_value: "default".into(),
        options: ["default", "read-only"]
            .into_iter()
            .map(|value| wire::ConfigChoice {
                value: value.into(),
                name: value.into(),
            })
            .collect(),
    }
}

/// A project whose `.warpforge/keepers/` holds `keepers` (id, yaml), the
/// tasks given, and HEAD `sha1` in every worktree task's checkout.
async fn setup(keepers: &[(&str, &str)], tasks: impl Fn(&str) -> Vec<Task>) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let worktree = dir.path().join("wt").to_string_lossy().into_owned();
    std::fs::create_dir_all(root.join(".warpforge/keepers")).unwrap();
    std::fs::create_dir_all(&worktree).unwrap();
    for (id, yaml) in keepers {
        std::fs::write(root.join(format!(".warpforge/keepers/{id}.yaml")), yaml).unwrap();
    }
    let log = dir.path().join("checker.log");
    let replies = dir.path().join("replies.txt");
    let fix_log = dir.path().join("fixer.log");
    let hold = dir.path().join("hold");
    std::fs::write(&replies, FINDING).unwrap();
    let db = dir.path().join("keepers.db");
    let store = Store::open_at(&db).unwrap();
    for task in tasks(&worktree) {
        store.upsert_task(&task).unwrap();
    }
    let projects = vec![crate::registry::ProjectEntry {
        name: "demo".into(),
        path: root.to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let daemon = Daemon::spawn(projects.clone(), Some(store));
    let events = daemon.subscribe();
    let script = Arc::new(Mutex::new(Scripted::default()));
    {
        let mut s = script.lock().unwrap();
        s.heads.insert(worktree.clone(), "sha1".into());
        s.changes.insert(
            worktree.clone(),
            Change {
                base_sha: Some("base0".into()),
                diff: "+fn parse(input: &str) { input[0] }".into(),
                log: vec!["sha1 add the parser".into()],
                files: vec!["src/lib.rs".into()],
                rules: String::new(),
            },
        );
    }
    let setup = Setup {
        daemon,
        events,
        script,
        worktree,
        log,
        replies,
        fix_log,
        hold,
        db,
        projects,
        _dir: dir,
    };
    wire_up(&setup).await;
    setup
}

/// The mock agents and the scripted git, on a fresh or a restarted daemon.
async fn wire_up(setup: &Setup) {
    let agent = |id: &str, name: &str, command: String| wire::AgentConfig {
        id: id.into(),
        display_name: name.into(),
        acp_command: command,
        enabled: true,
        models: vec![read_only_capable()],
        last_model: None,
    };
    let (log, replies) = (setup.log.display(), setup.replies.display());
    let (fix_log, hold) = (setup.fix_log.display(), setup.hold.display());
    setup
        .daemon
        .send(Command::UpdateAgents {
            agents: vec![
                agent(
                    "mockkeep",
                    "Mock keeper",
                    format!("node {CHECKER} {log} {replies}"),
                ),
                agent(
                    "mockfix",
                    "Mock fixer",
                    format!("node {FIXER} {fix_log} {hold}"),
                ),
            ],
        })
        .await;
    let git = GitSource::scripted(setup.script.clone());
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Script(git)))
        .await;
}

const REVIEW: &str = "version: 1\npreset: review\nagent: mockkeep\n";

async fn commit(setup: &Setup, task_id: &str) {
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Committed {
            task_id: task_id.into(),
        }))
        .await;
}

async fn move_head(setup: &Setup, sha: &str) {
    let mut s = setup.script.lock().unwrap();
    s.heads.insert(setup.worktree.clone(), sha.into());
    let change = s.changes.get_mut(&setup.worktree).unwrap();
    change.log.insert(0, format!("{sha} follow-up"));
}

/// The next `task.keeper` event whose run satisfies `done`.
async fn keeper_event(
    setup: &mut Setup,
    done: impl Fn(&wire::KeeperRun) -> bool,
) -> (wire::KeeperRun, Vec<wire::KeeperFinding>) {
    timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(Event::TaskKeeper { run, findings, .. }) = setup.events.recv().await {
                if done(&run) {
                    return (*run, findings);
                }
            }
        }
    })
    .await
    .expect("a keeper event")
}

fn finished(run: &wire::KeeperRun) -> bool {
    run.outcome.is_some()
}

fn logged(log: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

async fn checkers(daemon: &DaemonHandle) -> Vec<Task> {
    let tasks = daemon.tasks().await.into_iter();
    tasks
        .filter(|task| task.origin.as_deref() == Some("keeper"))
        .collect()
}

async fn wait_idle(daemon: &DaemonHandle, task_id: &str) {
    timeout(Duration::from_secs(10), async {
        loop {
            let task = daemon.tasks().await.into_iter().find(|t| t.id == task_id);
            if task.is_some_and(|t| t.status != TaskStatus::Running) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the checker goes idle");
}

/// Invariant 1 on a fresh start and on a resume: read-only mode before the
/// prompt, the edit denied, the task's checkout as cwd, no worktree owned.
#[tokio::test]
async fn a_commit_runs_one_read_only_checker_that_is_re_prompted_after_a_resume() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![task("t_a", Some(wt))]).await;
    commit(&setup, "t_a").await;
    let (run, findings) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Findings));
    assert_eq!((run.count, run.run_number), (1, 1));
    assert_eq!(run.head_sha, "sha1");
    assert_eq!(run.base_sha.as_deref(), Some("base0"));
    assert_eq!(run.cost.as_ref().map(|c| c.amount), Some(0.5));
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].status, wire::KeeperFindingStatus::Open);
    assert_eq!(findings[0].description, "panics on empty input");

    let log = logged(&setup.log);
    assert_eq!(log[0]["start"], "session/new");
    assert_eq!(
        log[0]["cwd"],
        setup.worktree.as_str(),
        "the task's checkout"
    );
    assert_eq!(
        (&log[1]["set"], &log[1]["value"]),
        (&"mode".into(), &"read-only".into())
    );
    assert_eq!(log[2]["mode"], "read-only", "read-only before the prompt");
    let prompt = log[2]["prompt"].as_str().unwrap();
    assert!(prompt.contains("You are Review"), "{prompt}");
    assert!(prompt.contains("input[0]"), "the diff: {prompt}");
    assert!(prompt.contains("Build the parser"), "the brief: {prompt}");
    assert_eq!(log[3]["permission"]["optionId"], "no", "the edit is denied");

    let checker = checkers(&setup.daemon).await.remove(0);
    assert_eq!(checker.parent_task_id.as_deref(), Some("t_a"));
    assert_eq!(checker.worktree, None, "a checker never owns a checkout");
    assert!(checker.tags.contains(&"keeper:review".to_string()));
    assert_eq!(run.checker_task_id.as_deref(), Some(checker.id.as_str()));

    wait_idle(&setup.daemon, &checker.id).await;
    setup.daemon.cancel_task(&checker.id).await.unwrap();
    std::fs::write(&setup.replies, APPROVE).unwrap();
    move_head(&setup, "sha2").await;
    commit(&setup, "t_a").await;
    let (second, _) = keeper_event(&mut setup, |run| finished(run) && run.head_sha == "sha2").await;
    assert_eq!(second.outcome, Some(wire::KeeperOutcome::Green));
    assert_eq!((second.run_number, second.head_sha.as_str()), (2, "sha2"));
    assert_eq!(
        second.checker_task_id, run.checker_task_id,
        "the same checker"
    );
    assert_eq!(checkers(&setup.daemon).await.len(), 1);

    let log = logged(&setup.log);
    let resumed = &log[4..];
    assert_eq!(resumed[0]["start"], "session/load", "{log:?}");
    assert_eq!(resumed[1]["value"], "read-only", "set again on resume");
    assert_eq!(resumed[2]["mode"], "read-only");
    let prompt = resumed[2]["prompt"].as_str().unwrap();
    assert!(prompt.contains("sha2 follow-up"), "{prompt}");
    assert!(
        !prompt.contains("sha1 add the parser"),
        "only new commits: {prompt}"
    );
    assert_eq!(resumed[3]["permission"]["optionId"], "no");
    setup.daemon.shutdown().await;
}

/// Only tasks with a commit keeper on have their HEAD read, and
/// nothing starts without a keeper file.
#[tokio::test]
async fn only_eligible_tasks_are_polled_and_no_keeper_file_spawns_nothing() {
    let off = "version: 1\npreset: review\nagent: mockkeep\ndefault: off\n";
    let setup = setup(&[("review", off)], |wt| {
        let mut on = task("t_on", Some(wt));
        on.keepers = Some(wire::TaskKeepers {
            overrides: [("review".to_string(), true)].into(),
            ..Default::default()
        });
        let mut done = task("t_done", Some(wt));
        done.status = TaskStatus::Done;
        done.keepers = on.keepers.clone();
        let mut factory = task("t_factory", Some(wt));
        factory.tags = vec!["workflow:default".into()];
        factory.keepers = on.keepers.clone();
        let mut hidden = task("t_hidden", Some(wt));
        hidden.origin = Some("pr-review".into());
        hidden.keepers = on.keepers.clone();
        vec![on, done, factory, hidden, task("t_default_off", Some(wt))]
    })
    .await;
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    timeout(Duration::from_secs(5), async {
        while setup.script.lock().unwrap().head_reads.is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the eligible task is polled");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        setup.script.lock().unwrap().head_reads,
        vec![setup.worktree.clone()],
        "one read, for t_on only"
    );
    assert!(checkers(&setup.daemon).await.is_empty(), "not settled yet");
    setup.daemon.shutdown().await;

    let bare = self::setup(&[], |wt| vec![task("t_a", Some(wt))]).await;
    commit(&bare, "t_a").await;
    bare.daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(bare.script.lock().unwrap().head_reads.is_empty());
    assert!(checkers(&bare.daemon).await.is_empty());
    assert!(!bare.log.exists(), "no agent started");
    bare.daemon.shutdown().await;
}

#[tokio::test]
async fn a_change_outside_the_keepers_paths_is_skipped_without_a_checker() {
    let docs = "version: 1\npreset: review\nagent: mockkeep\npaths: [\"docs/**\"]\n";
    let mut setup = setup(&[("review", docs)], |wt| vec![task("t_a", Some(wt))]).await;
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Skipped));
    assert!(run.error.unwrap().contains("paths"));
    assert!(checkers(&setup.daemon).await.is_empty());
    setup.daemon.shutdown().await;
}

/// A refusal is one skipped row per HEAD, retried on the next poll.
#[tokio::test]
async fn an_exhausted_account_skips_the_run_and_the_next_poll_retries() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![task("t_a", Some(wt))]).await;
    let exhausted = vec![crate::daemon::limits::gate::exhausted_row("mockkeep")];
    setup
        .daemon
        .send(Command::AgentLimitsUpdated {
            accounts: exhausted,
        })
        .await;
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Skipped));
    assert!(
        run.error.as_deref().unwrap().starts_with("quota"),
        "{run:?}"
    );
    assert!(checkers(&setup.daemon).await.is_empty());

    commit(&setup, "t_a").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let state = KeeperCommand::State {
        task_id: "t_a".into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(state)).await;
    assert_eq!(
        rx.await.unwrap().unwrap().runs.len(),
        1,
        "no second skipped row"
    );

    setup
        .daemon
        .send(Command::AgentLimitsUpdated {
            accounts: Vec::new(),
        })
        .await;
    commit(&setup, "t_a").await;
    let (retry, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(retry.outcome, Some(wire::KeeperOutcome::Findings));
    assert_eq!((retry.run_number, retry.head_sha.as_str()), (2, "sha1"));
    setup.daemon.shutdown().await;
}

/// Invariant 4: a HEAD that moves during the check supersedes the run.
#[tokio::test]
async fn a_head_that_moves_mid_run_supersedes_it() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, "WAIT").unwrap();
    commit(&setup, "t_a").await;
    let (started, _) = keeper_event(&mut setup, |run| run.checker_task_id.is_some()).await;
    move_head(&setup, "sha2").await;
    setup
        .daemon
        .send(Command::Keepers(KeeperCommand::Poll))
        .await;
    let (marked, _) = keeper_event(&mut setup, |run| run.error.is_some()).await;
    assert_eq!(
        (marked.id.as_str(), marked.outcome),
        (started.id.as_str(), None)
    );
    std::fs::write(format!("{}.go", setup.replies.display()), FINDING).unwrap();
    let (run, findings) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Skipped));
    assert_eq!(run.error.as_deref(), Some("superseded"));
    assert_eq!(findings.len(), 1, "kept for display");
    assert_eq!(findings[0].status, wire::KeeperFindingStatus::Superseded);
    setup.daemon.shutdown().await;
}

#[tokio::test]
async fn a_checker_past_its_time_limit_is_stopped_and_the_run_is_inconclusive() {
    let quick = "version: 1\npreset: review\nagent: mockkeep\ntime_limit: 1s\n";
    let mut setup = setup(&[("review", quick)], |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, "WAIT").unwrap();
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Inconclusive));
    assert!(run.error.unwrap().contains("within"));
    let checker = checkers(&setup.daemon).await.remove(0);
    assert_eq!(checker.status, TaskStatus::Interrupted);
    setup.daemon.shutdown().await;
}

/// One re-ask on an unreadable reply, then inconclusive.
#[tokio::test]
async fn an_unreadable_verdict_is_asked_for_once() {
    let mut setup = setup(&[("review", REVIEW)], |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, "Looks fine.\n---\n".to_string() + APPROVE).unwrap();
    commit(&setup, "t_a").await;
    let (run, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(run.outcome, Some(wire::KeeperOutcome::Green));
    let prompts: Vec<String> = logged(&setup.log)
        .iter()
        .filter_map(|entry| entry["prompt"].as_str().map(str::to_string))
        .collect();
    assert_eq!(prompts.len(), 2);
    assert!(prompts[1].contains("could not be parsed"), "{}", prompts[1]);

    std::fs::write(&setup.replies, "Still prose.").unwrap();
    move_head(&setup, "sha2").await;
    commit(&setup, "t_a").await;
    let (garbled, _) = keeper_event(&mut setup, finished).await;
    assert_eq!(garbled.outcome, Some(wire::KeeperOutcome::Inconclusive));
    assert!(garbled.error.unwrap().contains("no readable verdict"));
    setup.daemon.shutdown().await;
}
