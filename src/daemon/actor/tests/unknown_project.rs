use crate::daemon::actor::*;
use crate::daemon::task::TaskStatus;
use std::time::Duration;

const MOCK_AGENT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-inspect.mjs"
);

#[tokio::test]
async fn unregistered_project_blocks_the_task_instead_of_running_in_daemon_cwd() {
    let handle = Daemon::spawn(Vec::new(), None);
    let id = handle
        .create_task(
            "ghost",
            "do the thing",
            &format!("node {MOCK_AGENT}"),
            Vec::new(),
            false,
            false,
            None,
            Vec::new(),
            None,
            Default::default(),
            None,
        )
        .await;

    let task = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let task = handle
                .tasks()
                .await
                .into_iter()
                .find(|t| t.id == id)
                .expect("task on the board");
            if task.status == TaskStatus::Blocked {
                break task;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("task never blocked");

    let reason = task.blocked_reason.expect("a visible reason");
    assert!(
        reason.contains("ghost"),
        "reason names the project: {reason}"
    );
    assert!(task.worktree.is_none());
}
