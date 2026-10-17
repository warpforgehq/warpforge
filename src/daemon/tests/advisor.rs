use super::*;
use crate::daemon::actor::advisor::{AdvisorAnswer, AdvisorTicket};
use tokio::sync::oneshot;
use warpforge_protocol as wire;

const ADVISOR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-advisor.mjs"
);
const EXECUTOR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-inspect.mjs"
);

struct Setup {
    daemon: DaemonHandle,
    events: tokio::sync::broadcast::Receiver<Event>,
    executor: String,
    log: std::path::PathBuf,
    _dir: tempfile::TempDir,
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

/// An executor that has finished its first turn, with the mock advisor
/// registered as agent `mockadv`.
async fn advised_task(limits: Vec<wire::AgentAccountLimits>) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("advisor.log");
    let projects = vec![crate::registry::ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(projects, store);
    let mut events = daemon.subscribe();
    daemon
        .send(Command::UpdateAgents {
            agents: vec![wire::AgentConfig {
                id: "mockadv".into(),
                display_name: "Mock advisor".into(),
                acp_command: format!("node {ADVISOR} {}", log.display()),
                enabled: true,
                models: vec![read_only_capable()],
                last_model: None,
            }],
        })
        .await;
    daemon
        .send(Command::AgentLimitsUpdated { accounts: limits })
        .await;
    let (tx, rx) = oneshot::channel();
    daemon
        .send(Command::CreateTask {
            project: "demo".into(),
            prompt: "Build the parser".into(),
            agent: format!("node {EXECUTOR}"),
            tags: Vec::new(),
            include_runtime_context: false,
            worktree: false,
            worktree_base: Default::default(),
            parent_task_id: None,
            attachments: Vec::new(),
            default_model: None,
            config_overrides: std::collections::HashMap::new(),
            backlog_item_id: None,
            origin: None,
            start: true,
            advisor: Some(wire::AdvisorPick {
                agent: "mockadv".into(),
                model: None,
            }),
            smith_id: None,
            reply: tx,
        })
        .await;
    let executor = rx.await.unwrap();
    timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == executor && task.status == TaskStatus::Waiting {
                    break;
                }
            }
        }
    })
    .await
    .expect("the executor finishes its first turn");
    Setup {
        daemon,
        events,
        executor,
        log,
        _dir: dir,
    }
}

async fn ask(daemon: &DaemonHandle, task: &str, question: &str) -> Result<AdvisorAnswer, String> {
    let (tx, rx) = oneshot::channel();
    daemon
        .send(Command::AdvisorAsk {
            task_id: task.into(),
            question: question.into(),
            context: None,
            reply: tx,
        })
        .await;
    match rx.await.unwrap()? {
        AdvisorTicket::Ready(answer) => Ok(answer),
        AdvisorTicket::Waiting { answer, .. } => Ok(timeout(Duration::from_secs(20), answer)
            .await
            .expect("the advisor answers")
            .expect("the consultation stays open")),
    }
}

fn logged(log: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

async fn task(daemon: &DaemonHandle, id: &str) -> Option<Task> {
    daemon.tasks().await.into_iter().find(|task| task.id == id)
}

/// One hidden, read-only advisor session answers every question, remembers
/// the earlier ones, and its answers land in the executor's chat.
#[tokio::test]
async fn the_advisor_is_one_read_only_session_that_answers_in_the_executors_chat() {
    let mut setup = advised_task(Vec::new()).await;
    let (daemon, executor) = (&setup.daemon, setup.executor.clone());

    let first = ask(daemon, &executor, "Which lexer should I use?").await;
    assert_eq!(
        first.unwrap().answer,
        Ok("Advice 1: Which lexer should I use?".into())
    );

    let log = logged(&setup.log);
    assert_eq!(log[0]["set"], "mode", "{log:?}");
    assert_eq!(log[0]["value"], "read-only");
    let prompt = log[1]["prompt"].as_str().unwrap();
    assert_eq!(
        log[1]["mode"], "read-only",
        "read-only before the first question"
    );
    assert!(prompt.contains("You only advise"), "{prompt}");
    assert!(
        prompt.contains("Build the parser"),
        "the task's goal: {prompt}"
    );
    assert!(
        prompt.contains("> blocks:text"),
        "the executor's message: {prompt}"
    );
    assert_eq!(log[2]["permission"]["optionId"], "no", "the edit is denied");

    let second = ask(daemon, &executor, "And the error type?").await.unwrap();
    assert_eq!(second.answer, Ok("Advice 2: And the error type?".into()));
    let later = logged(&setup.log)
        .into_iter()
        .filter_map(|entry| entry["prompt"].as_str().map(str::to_string))
        .nth(1)
        .unwrap();
    assert!(!later.contains("You only advise"), "{later}");
    assert!(later.contains("since the last question"), "{later}");

    let record = task(daemon, &executor).await.unwrap().advisor.unwrap();
    assert_eq!(record.consultations, 2);
    assert_eq!(record.cost.as_ref().map(|c| c.amount), Some(0.5));
    let advisor_id = record.task_id.unwrap();
    let advisor = task(daemon, &advisor_id).await.unwrap();
    assert_eq!(advisor.origin.as_deref(), Some("advisor"));
    assert_eq!(advisor.parent_task_id.as_deref(), Some(executor.as_str()));
    assert_eq!(advisor.worktree, None, "the advisor never owns a checkout");

    let mut blocks = Vec::new();
    while let Ok(event) = setup.events.try_recv() {
        if let Event::SessionUpdate {
            task_id,
            update: wire::SessionUpdate::AdvisorConsultation { question, cost, .. },
        } = event
        {
            assert_eq!(task_id, executor);
            blocks.push((question, cost.map(|c| c.amount)));
        }
    }
    assert_eq!(
        blocks,
        [
            ("Which lexer should I use?".to_string(), Some(0.25)),
            ("And the error type?".to_string(), Some(0.25)),
        ]
    );

    let (tx, rx) = oneshot::channel();
    daemon
        .send(Command::DeleteTask {
            id: executor.clone(),
            reply: tx,
        })
        .await;
    rx.await.unwrap().unwrap();
    timeout(Duration::from_secs(10), async {
        while task(daemon, &advisor_id).await.is_some() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("deleting the executor deletes its advisor");
    setup.daemon.shutdown().await;
}

/// A turn gets three questions; a task without an advisor gets none.
#[tokio::test]
async fn questions_are_capped_per_turn() {
    let setup = advised_task(Vec::new()).await;
    let (daemon, executor) = (&setup.daemon, setup.executor.as_str());
    for n in 1..=3 {
        assert!(ask(daemon, executor, &format!("q{n}")).await.is_ok());
    }
    let refused = ask(daemon, executor, "q4").await.unwrap_err();
    assert!(refused.contains("3 questions this turn"), "{refused}");

    let other = daemon
        .create_task(
            "demo",
            "no advisor here",
            &format!("node {EXECUTOR}"),
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    let refused = ask(daemon, &other, "anyone?").await.unwrap_err();
    assert!(refused.contains("no advisor"), "{refused}");
    setup.daemon.shutdown().await;
}

/// The quota gate holds an advisor whose account is known to be exhausted.
#[tokio::test]
async fn an_exhausted_advisor_account_refuses_the_question() {
    let setup = advised_task(vec![crate::daemon::limits::gate::exhausted_row("mockadv")]).await;
    let refused = ask(&setup.daemon, &setup.executor, "q?").await.unwrap_err();
    assert!(refused.contains("out of quota"), "{refused}");
    assert!(logged(&setup.log).is_empty(), "no advisor was started");
    setup.daemon.shutdown().await;
}

/// A window that ends before the answer loses nothing: the answer waits for
/// the next `advisor.wait`, and no second question is taken meanwhile.
#[tokio::test]
async fn an_answer_outlives_the_wait_that_gave_up_on_it() {
    let setup = advised_task(Vec::new()).await;
    let (daemon, executor) = (&setup.daemon, setup.executor.as_str());
    let (tx, rx) = oneshot::channel();
    daemon
        .send(Command::AdvisorAsk {
            task_id: executor.into(),
            question: "Slow one?".into(),
            context: Some("tried twice".into()),
            reply: tx,
        })
        .await;
    drop(rx.await.unwrap().expect("asked"));
    let busy = ask(daemon, executor, "Another?").await.unwrap_err();
    assert!(busy.contains("wait: true"), "{busy}");

    timeout(Duration::from_secs(20), async {
        loop {
            let advisor = task(daemon, executor).await.and_then(|t| t.advisor);
            if advisor.is_some_and(|a| a.consultations == 1) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the advisor answers with nobody waiting");
    let (tx, rx) = oneshot::channel();
    daemon
        .send(Command::AdvisorWait {
            task_id: executor.into(),
            reply: tx,
        })
        .await;
    let Ok(AdvisorTicket::Ready(answer)) = rx.await.unwrap() else {
        panic!("the unread answer is handed over at once");
    };
    assert_eq!(answer.answer, Ok("Advice 1: tried twice".into()));
    let prompt = logged(&setup.log)[1]["prompt"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(prompt.contains("Slow one?"), "{prompt}");
    setup.daemon.shutdown().await;
}
