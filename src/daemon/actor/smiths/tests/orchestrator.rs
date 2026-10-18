//! An orchestrator lead run as a Smith (ADR 0027 invariant 16): the Smith's
//! persona on the lead, both tool sets on its bridge, plain workers.

use super::sessions::{ada_on, agent, prompt_texts, requests, wait};
use super::*;

async fn lead(daemon: &DaemonHandle, smith_id: &str) -> String {
    ask(daemon, |reply| SmithCommand::StartWork {
        id: smith_id.into(),
        project: "demo".into(),
        brief: "split the migration across workers".into(),
        backlog_item_id: None,
        worktree: false,
        orchestrator: true,
        reply,
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a_smith_can_lead_as_an_orchestrator_with_both_tool_sets() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let lead = lead(&daemon, &ada.id).await;
    let log = agent.log.clone();
    wait("the lead's opening prompt", || {
        !prompt_texts(&log).is_empty()
    })
    .await;

    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == lead)
        .expect("the lead");
    assert!(task.tags.iter().any(|tag| tag == "orchestrator-chat"));
    let record = task.smith.expect("run as the Smith");
    assert_eq!(record.smith_id, ada.id);
    assert_eq!(record.depth, 0, "the lead is depth 0 for start_work");
    assert_eq!(task.origin, None, "a work session, not the thread");

    let opening = &prompt_texts(&agent.log)[0];
    let constitution = opening
        .find("<smith_constitution>")
        .expect("the constitution");
    assert!(opening.contains("Never guesses."), "the soul");
    let orchestrator = opening
        .find("You are an orchestrator agent")
        .expect("the orchestrator preamble");
    assert!(constitution < orchestrator, "{opening}");
    let new = &requests(&agent.log, "session/new")[0];
    let env = new["mcpServers"][0]["env"].as_array().unwrap();
    assert!(
        env.iter()
            .any(|e| e["name"] == "WF_MODE" && e["value"] == "smith-orchestrator"),
        "{env:?}"
    );
}

#[tokio::test]
async fn a_worker_the_smith_led_orchestrator_spawns_carries_no_persona() {
    let home = home();
    let lead_agent = agent(home._dir.path(), false);
    let worker_dir = tempfile::tempdir().unwrap();
    let worker_agent = agent(worker_dir.path(), false);
    let daemon = spawn(&home, &[]);
    daemon
        .send(Command::Smiths(SmithCommand::UseMemory {
            path: home.root.with_file_name("memory.db"),
        }))
        .await;
    let ada = create(&daemon, ada_on(&lead_agent)).await.unwrap().smith;
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::MemoryStore {
            content: "the migration needs a lock first".into(),
            scope: Some(format!("smith:{}", ada.id)),
            kind: None,
            tags: None,
            project_id: None,
            created_by: Some(ada.thread_task_id.clone()),
            reply: tx,
        })
        .await;
    rx.await.unwrap().unwrap();
    let lead = lead(&daemon, &ada.id).await;
    let lead_log = lead_agent.log.clone();
    wait("the lead's opening prompt", || {
        !prompt_texts(&lead_log).is_empty()
    })
    .await;
    assert!(
        prompt_texts(&lead_agent.log)[0].contains("the migration needs a lock first"),
        "the lead hears its journal"
    );

    // What spawn_agent sends: a `subagent` child of the lead.
    let worker = daemon
        .create_task(
            "demo",
            "migrate the users table",
            &worker_agent.command,
            vec!["orchestrator".into(), "subagent".into()],
            false,
            false,
            Some(lead.clone()),
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
    let worker_log = worker_agent.log.clone();
    wait("the worker's opening prompt", || {
        !prompt_texts(&worker_log).is_empty()
    })
    .await;

    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == worker)
        .expect("the worker");
    assert!(task.smith.is_none(), "no smith_id on a worker");
    let opening = &prompt_texts(&worker_agent.log)[0];
    for persona in [
        "<smith_constitution>",
        "Never guesses.",
        "<smith_update>",
        "the migration needs a lock first",
    ] {
        assert!(!opening.contains(persona), "{persona}: {opening}");
    }
    let new = &requests(&worker_agent.log, "session/new")[0];
    assert!(new.get("_meta").is_none(), "no system prompt either");
    let env = new["mcpServers"][0]["env"].as_array().unwrap();
    assert!(
        env.iter()
            .any(|e| e["name"] == "WF_MODE" && e["value"] == "single"),
        "a worker's bridge has neither orchestrator nor Smith tools: {env:?}"
    );
}

const WRITER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-writer.mjs"
);

/// The writer mock's answer to its `fs/write_text_file`.
async fn write_answer(log: &Path) -> serde_json::Value {
    let answer = || {
        std::fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|a| a["id"] == 900)
    };
    wait("the write's answer", || answer().is_some()).await;
    answer().unwrap()
}

/// A plain task under `parent` whose agent writes `target` outside any
/// write path, as spawn_agent would create it.
async fn writer_under(
    daemon: &DaemonHandle,
    dir: &Path,
    parent: &str,
) -> (String, PathBuf, PathBuf) {
    let log = dir.join(format!("{parent}.log"));
    let target = dir.join(format!("{parent}.txt"));
    let command = format!("node {WRITER} {} {}", log.display(), target.display());
    let id = daemon
        .create_task(
            "demo",
            "write it",
            &command,
            vec!["orchestrator".into(), "subagent".into()],
            false,
            false,
            Some(parent.to_string()),
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
    (id, log, target)
}

#[tokio::test]
async fn workers_under_a_smith_led_orchestrator_inherit_its_write_limit_not_its_persona() {
    let home = home();
    let lead_agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let mut spec = ada_on(&lead_agent);
    spec.permissions = Some(wire::SmithPermissions {
        write_paths: vec!["src/".into()],
        push: false,
        create_pr: false,
    });
    let ada = create(&daemon, spec).await.unwrap().smith;
    let lead = lead(&daemon, &ada.id).await;

    let (worker, log, target) = writer_under(&daemon, home._dir.path(), &lead).await;
    let answer = write_answer(&log).await;
    assert!(answer["error"].is_object(), "{answer}");
    assert!(!target.exists());
    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == worker)
        .unwrap();
    assert!(task.smith.is_none(), "the limit, never the persona");
    let limit = task.write_limit.expect("the lead's limit");
    assert_eq!(
        (limit.smith_id.as_str(), limit.paths),
        (ada.id.as_str(), vec!["src/".to_string()])
    );

    let (nested, log, target) = writer_under(&daemon, home._dir.path(), &worker).await;
    assert!(
        write_answer(&log).await["error"].is_object(),
        "a nested spawn too"
    );
    assert!(!target.exists());
    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == nested)
        .unwrap();
    assert!(task.smith.is_none() && task.write_limit.is_some());
}

#[tokio::test]
async fn a_smith_without_write_paths_leaves_its_workers_unlimited() {
    let home = home();
    let lead_agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada_on(&lead_agent)).await.unwrap().smith;
    let lead = lead(&daemon, &ada.id).await;

    let (worker, log, target) = writer_under(&daemon, home._dir.path(), &lead).await;
    assert!(write_answer(&log).await["error"].is_null());
    assert!(target.exists());
    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == worker)
        .unwrap();
    assert!(task.write_limit.is_none());
}
