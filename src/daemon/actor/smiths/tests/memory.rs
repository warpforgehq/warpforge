//! The memory preamble reaches every kind of session that can use memory.

use super::sessions::{ada_on, agent, prompt_texts, wait, Agent};
use super::*;

const PREAMBLE: &str = "Before deciding an approach, memory_search the topic";

async fn with_memory(daemon: &DaemonHandle, home: &Home) {
    daemon
        .send(Command::Smiths(SmithCommand::UseMemory {
            path: home.root.with_file_name("memory.db"),
        }))
        .await;
}

async fn opening(agent: &Agent) -> String {
    let log = agent.log.clone();
    wait("the opening prompt", || !prompt_texts(&log).is_empty()).await;
    prompt_texts(&agent.log).remove(0)
}

async fn plain(daemon: &DaemonHandle, agent: &Agent, tags: Vec<String>) {
    daemon
        .create_task(
            "demo",
            "fix it",
            &agent.command,
            tags,
            false,
            false,
            None,
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
}

#[tokio::test]
async fn single_orchestrator_thread_and_work_sessions_all_hear_the_memory_preamble() {
    let home = home();
    let daemon = spawn(&home, &[]);
    with_memory(&daemon, &home).await;
    let dirs: Vec<_> = (0..4).map(|_| tempfile::tempdir().unwrap()).collect();
    let agents: Vec<Agent> = dirs.iter().map(|d| agent(d.path(), false)).collect();

    plain(&daemon, &agents[0], vec![]).await;
    plain(&daemon, &agents[1], vec!["orchestrator-chat".into()]).await;
    let ada = create(&daemon, ada_on(&agents[2])).await.unwrap().smith;
    daemon
        .session_prompt(&ada.thread_task_id, "what is flaky?", vec![])
        .await
        .unwrap();
    let mut bo = ada_on(&agents[3]);
    bo.name = "Bo".into();
    let bo = create(&daemon, bo).await.unwrap().smith;
    ask(&daemon, |reply| SmithCommand::StartWork {
        id: bo.id.clone(),
        project: "demo".into(),
        brief: "fix the flake".into(),
        backlog_item_id: None,
        worktree: false,
        orchestrator: false,
        reply,
    })
    .await
    .unwrap();

    for (agent, path) in agents
        .iter()
        .zip(["single", "orchestrator", "thread", "work"])
    {
        let text = opening(agent).await;
        assert!(text.contains(PREAMBLE), "{path}: {text}");
        assert!(!text.contains("Prefer this over"), "{path}");
    }
}

#[tokio::test]
async fn no_preamble_while_memory_is_off() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let dir = tempfile::tempdir().unwrap();
    let agent = agent(dir.path(), false);
    plain(&daemon, &agent, vec![]).await;
    assert!(!opening(&agent).await.contains(PREAMBLE));
}
