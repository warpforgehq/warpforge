//! The thread never edits code (ADR 0027 invariant 6).

use super::sessions::wait;
use super::*;

const WRITER: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-writer.mjs"
);

/// ADR 0027 invariant 6 through ADR 0022's enforcement: the thread's file
/// writes and permission prompts are refused by the daemon.
#[tokio::test]
async fn the_thread_cannot_write_files_or_be_granted_permissions() {
    let home = home();
    let log = home._dir.path().join("writer.log");
    let target = home._dir.path().join("written.txt");
    let daemon = spawn(&home, &[]);
    let mut spec = ada();
    spec.agent = format!("node {WRITER} {} {}", log.display(), target.display());
    let ada = create(&daemon, spec).await.unwrap().smith;
    daemon
        .session_prompt(&ada.thread_task_id, "clean the build", vec![])
        .await
        .unwrap();
    let answers = || {
        std::fs::read_to_string(&log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .collect::<Vec<_>>()
    };
    wait("both answers", || answers().len() == 2).await;
    let answers = answers();
    let write = answers.iter().find(|a| a["id"] == 900).unwrap();
    assert!(
        write["error"]["message"]
            .as_str()
            .unwrap()
            .contains("denied"),
        "{write}"
    );
    assert!(!target.exists(), "nothing was written");
    let permission = answers.iter().find(|a| a["id"] == 901).unwrap();
    assert_ne!(
        permission["result"]["outcome"]["optionId"], "allow",
        "{permission}"
    );
}

async fn writer_answer(log: &Path) -> serde_json::Value {
    let answers = || {
        std::fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|a| a["id"] == 900)
    };
    wait("the write's answer", || answers().is_some()).await;
    answers().unwrap()
}

/// A work session's write paths are enforced where the daemon sees the
/// write; with none set it writes anywhere it could before.
#[tokio::test]
async fn a_work_session_writes_only_under_its_smiths_write_paths() {
    for (paths, allowed) in [(vec!["src/".to_string()], false), (Vec::new(), true)] {
        let home = home();
        let log = home._dir.path().join("writer.log");
        let target = home._dir.path().join("written.txt");
        let daemon = spawn(&home, &[]);
        let mut spec = ada();
        spec.agent = format!("node {WRITER} {} {}", log.display(), target.display());
        spec.permissions = Some(wire::SmithPermissions {
            write_paths: paths.clone(),
            push: false,
            create_pr: false,
        });
        let smith = create(&daemon, spec).await.unwrap().smith;
        ask(&daemon, |reply| SmithCommand::StartWork {
            id: smith.id.clone(),
            project: "demo".into(),
            brief: "write it".into(),
            backlog_item_id: None,
            worktree: false,
            reply,
        })
        .await
        .unwrap();
        let answer = writer_answer(&log).await;
        assert_eq!(answer["error"].is_object(), !allowed, "{paths:?}: {answer}");
        assert_eq!(target.exists(), allowed, "{paths:?}");
    }
}
