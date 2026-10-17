//! A Smith's sessions (ADR 0027): the read-only thread, work sessions on the
//! board, and what each is told — constitution, soul, journal, then deltas.

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use serde_json::Value;

use super::*;
use crate::daemon::actor::smiths::session::system_text;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-smith.mjs"
);

pub(super) struct Agent {
    pub(super) command: String,
    pub(super) log: PathBuf,
}

/// The mock agent, run directly or through a script named like the Claude
/// adapter so the `_meta` path is taken.
pub(super) fn agent(dir: &Path, as_claude: bool) -> Agent {
    let log = dir.join("acp.log");
    let direct = format!("node {FIXTURE} {}", log.display());
    if !as_claude {
        return Agent {
            command: direct,
            log,
        };
    }
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join("claude-agent-acp");
    std::fs::write(&script, format!("#!/bin/sh\nexec {direct}\n")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    Agent {
        command: script.display().to_string(),
        log,
    }
}

pub(super) fn requests(log: &Path, method: &str) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|line| line["method"] == method)
        .map(|line| line["params"].clone())
        .collect()
}

pub(super) fn prompt_texts(log: &Path) -> Vec<String> {
    requests(log, "session/prompt")
        .iter()
        .map(|params| {
            params["prompt"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|block| block["text"].as_str())
                .collect::<String>()
        })
        .collect()
}

pub(super) async fn wait(what: &str, check: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

pub(super) async fn wait_idle(daemon: &DaemonHandle, task_id: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let idle = daemon.tasks().await.iter().any(|t| {
                t.id == task_id && t.status == TaskStatus::Waiting && t.queued_prompts.is_empty()
            });
            if idle {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the task goes idle");
}

pub(super) fn ada_on(agent: &Agent) -> wire::SmithCreate {
    let mut create = ada();
    create.agent = agent.command.clone();
    create.soul = Some("# Ada\n\nTerse. Never guesses.\n".into());
    create
}

async fn start_work(
    daemon: &DaemonHandle,
    id: &str,
    project: &str,
    brief: &str,
) -> Result<String, String> {
    ask(daemon, |reply| SmithCommand::StartWork {
        id: id.into(),
        project: project.into(),
        brief: brief.into(),
        backlog_item_id: None,
        worktree: false,
        reply,
    })
    .await
}

async fn edit_soul(daemon: &DaemonHandle, id: &str, soul: &str) {
    ask(daemon, |reply| SmithCommand::Update {
        id: id.into(),
        patch: Box::new(wire::SmithPatch {
            soul: Some(soul.into()),
            ..Default::default()
        }),
        reply,
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn the_first_message_starts_a_read_only_thread_that_hears_the_constitution_first() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    daemon
        .session_prompt(&smith.thread_task_id, "what is flaky?", vec![])
        .await
        .unwrap();
    let log = agent.log.clone();
    wait("the thread's first prompt", || {
        !prompt_texts(&log).is_empty()
    })
    .await;

    let text = &prompt_texts(&agent.log)[0];
    let constitution = text.find("<smith_constitution>").expect("the constitution");
    let soul = text.find("Never guesses.").expect("the soul");
    let message = text.find("what is flaky?").expect("the message");
    assert!(constitution < soul && soul < message, "{text}");
    let new = &requests(&agent.log, "session/new")[0];
    assert!(
        new.get("_meta").is_none(),
        "not the Claude adapter: a prefix, no _meta"
    );
    let env = new["mcpServers"][0]["env"].as_array().unwrap();
    assert!(
        env.iter()
            .any(|e| e["name"] == "WF_MODE" && e["value"] == "thread"),
        "the thread's bridge serves the thread's tools only"
    );
}

#[tokio::test]
async fn a_work_session_is_a_named_board_task_in_an_allowed_project() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[task("t_o", "other")]);
    let mut spec = ada_on(&agent);
    spec.account_id = Some("acc_ada".into());
    let smith = create(&daemon, spec).await.unwrap().smith;

    let refused = start_work(&daemon, &smith.id, "third", "fix it")
        .await
        .unwrap_err();
    assert!(refused.contains("may not work in third"), "{refused}");

    let work = start_work(&daemon, &smith.id, "other", "fix the login flake")
        .await
        .unwrap();
    let task = daemon
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == work)
        .unwrap();
    assert_eq!(task.parent_task_id, None, "never the thread's child");
    assert_eq!(task.origin, None, "on the board");
    assert_eq!(task.account_id.as_deref(), Some("acc_ada"));
    assert_eq!(task.smith.as_ref().unwrap().smith_id, smith.id);

    let peers = peers_of(&daemon, "t_o").await;
    let entry = peers
        .iter()
        .find(|p| p.id == work)
        .expect("in the directory");
    assert_eq!(entry.kind, wire::PeerKind::Task);
    assert_eq!(wire::peer_label(entry), "Ada · fix the login flake");
}

#[tokio::test]
async fn a_held_smith_starts_nothing() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    ask(&daemon, |reply| SmithCommand::SetPaused {
        id: smith.id.clone(),
        paused: true,
        reply,
    })
    .await
    .unwrap();
    let refused = start_work(&daemon, &smith.id, "demo", "fix it")
        .await
        .unwrap_err();
    assert!(refused.contains("held"), "{refused}");
    let thread = daemon
        .session_prompt(&smith.thread_task_id, "hello", vec![])
        .await
        .unwrap_err();
    assert_eq!(thread, "Ada is paused");
    assert!(requests(&agent.log, "session/new").is_empty());
}

/// Invariant 4: the Claude adapter gets the constitution and soul as
/// `_meta.systemPrompt`, and a resume sends exactly the same value even
/// after the soul changed; the change arrives as `<smith_update>`.
#[tokio::test]
async fn the_system_prompt_is_byte_stable_and_a_soul_edit_arrives_as_a_delta() {
    let home = home();
    let agent = agent(home._dir.path(), true);
    let daemon = spawn(&home, &[]);
    daemon
        .send(Command::Smiths(SmithCommand::SetClaudeMeta { on: true }))
        .await;
    let smith = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let work = start_work(&daemon, &smith.id, "demo", "fix the login flake")
        .await
        .unwrap();
    let log = agent.log.clone();
    wait("the opening prompt", || prompt_texts(&log).len() == 1).await;
    let new = requests(&agent.log, "session/new").remove(0);
    let meta = new["_meta"].clone();
    assert_eq!(
        meta["systemPrompt"]["append"],
        system_text("# Ada\n\nTerse. Never guesses.\n")
    );
    assert!(
        !prompt_texts(&agent.log)[0].contains("<smith_constitution>"),
        "the soul is not repeated in the prompt"
    );
    wait_idle(&daemon, &work).await;

    edit_soul(&daemon, &smith.id, "# Ada\n\nTerse. Checks twice.\n").await;
    daemon.cancel_task(&work).await.unwrap();
    daemon.session_prompt(&work, "go on", vec![]).await.unwrap();
    wait("the resumed prompt", || prompt_texts(&log).len() == 2).await;
    let load = requests(&agent.log, "session/load").remove(0);
    assert_eq!(load["_meta"], meta, "the same value, byte for byte");
    let resumed = &prompt_texts(&agent.log)[1];
    assert!(resumed.contains("<smith_update>"), "{resumed}");
    assert!(resumed.contains("Checks twice."));
    wait_idle(&daemon, &work).await;

    daemon
        .session_prompt(&work, "and then", vec![])
        .await
        .unwrap();
    wait("the third prompt", || prompt_texts(&log).len() == 3).await;
    assert!(
        !prompt_texts(&agent.log)[2].contains("<smith_update>"),
        "the delta is sent once"
    );
}

/// `@Ada` is the Smith's thread, even beside a task whose title is "Ada".
#[tokio::test]
async fn a_bare_mention_of_a_smiths_name_reaches_its_thread() {
    let home = home();
    let mut namesake = task("t_ada", "demo");
    namesake.title = "Ada".into();
    let daemon = spawn(&home, &[task("t_a", "demo"), namesake]);
    let smith = create(&daemon, ada()).await.unwrap().smith;
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::Message {
            from_task_id: "t_a".into(),
            to: "team".into(),
            message: "@Ada can you look at CI?".into(),
            reply: tx,
        }))
        .await;
    let sent = rx.await.unwrap().unwrap();
    assert_eq!(
        sent.message.unwrap().mentions,
        vec![smith.thread_task_id.clone()]
    );
}

/// Without `_meta`, a restarted session hears its constitution and soul
/// again from its opening prompt.
#[tokio::test]
async fn a_prefix_session_hears_its_soul_again_after_a_restart() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    let smith = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let work = start_work(&daemon, &smith.id, "demo", "fix the login flake")
        .await
        .unwrap();
    let log = agent.log.clone();
    wait("the opening prompt", || prompt_texts(&log).len() == 1).await;
    wait_idle(&daemon, &work).await;
    daemon.cancel_task(&work).await.unwrap();
    daemon.session_prompt(&work, "go on", vec![]).await.unwrap();
    wait("the resumed prompt", || prompt_texts(&log).len() == 2).await;
    let resumed = &prompt_texts(&agent.log)[1];
    let constitution = resumed
        .find("<smith_constitution>")
        .expect("the constitution");
    let soul = resumed.find("Never guesses.").expect("the soul");
    assert!(constitution < soul, "{resumed}");
}

/// Two journal entries in one second are two entries: the cursor is the row,
/// not the timestamp.
#[tokio::test]
async fn a_journal_entry_in_the_same_second_is_still_delivered() {
    let home = home();
    let agent = agent(home._dir.path(), false);
    let daemon = spawn(&home, &[]);
    daemon
        .send(Command::Smiths(SmithCommand::UseMemory {
            path: home.root.with_file_name("memory.db"),
        }))
        .await;
    let smith = create(&daemon, ada_on(&agent)).await.unwrap().smith;
    let journal = format!("smith:{}", smith.id);
    let note = |content: &'static str| {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let cmd = Command::MemoryStore {
            content: content.into(),
            scope: Some(journal.clone()),
            kind: None,
            tags: None,
            project_id: None,
            created_by: Some(smith.thread_task_id.clone()),
            reply: tx,
        };
        (cmd, rx)
    };
    let (first, written) = note("first entry");
    daemon.send(first).await;
    written.await.unwrap().unwrap();
    let work = start_work(&daemon, &smith.id, "demo", "fix the login flake")
        .await
        .unwrap();
    let log = agent.log.clone();
    wait("the opening prompt", || prompt_texts(&log).len() == 1).await;
    assert!(prompt_texts(&agent.log)[0].contains("first entry"));
    wait_idle(&daemon, &work).await;

    let (second, written) = note("second entry");
    daemon.send(second).await;
    written.await.unwrap().unwrap();
    daemon.session_prompt(&work, "next", vec![]).await.unwrap();
    wait("the next prompt", || prompt_texts(&log).len() == 2).await;
    let next = &prompt_texts(&agent.log)[1];
    assert!(next.contains("second entry"), "{next}");
    assert!(!next.contains("first entry"), "{next}");
}
