//! Sending one keeper command and reading the actor's answer.

use super::*;

/// Send one `KeeperCommand` and await the actor's answer.
pub(super) async fn ask<T>(
    setup: &Setup,
    command: impl FnOnce(tokio::sync::oneshot::Sender<Result<T, String>>) -> KeeperCommand,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    setup.daemon.send(Command::Keepers(command(tx))).await;
    rx.await
        .unwrap_or_else(|_| Err("daemon dropped the reply".into()))
}

/// `keepers.checkReady` for `task_id`, with the keepers it started.
pub(super) async fn check_ready_on(
    setup: &Setup,
    task_id: &str,
    sha: &str,
) -> Result<Vec<String>, String> {
    ask(setup, |reply| KeeperCommand::CheckReady {
        task_id: task_id.into(),
        reply,
    })
    .await
    .map(|(head, started)| {
        assert_eq!(head, sha, "the reply names the HEAD it checks");
        started
    })
}

/// `keepers.checkReady` for t_a on sha1, with the keepers it started.
pub(super) async fn check_ready(setup: &Setup) -> Vec<String> {
    check_ready_on(setup, "t_a", "sha1").await.unwrap()
}

/// **Send to agent** for `keeper_id` on t_a.
pub(super) async fn send_findings(setup: &Setup, keeper_id: &str) -> Result<(), String> {
    ask(setup, |reply| KeeperCommand::SendFindings {
        task_id: "t_a".into(),
        keeper_id: keeper_id.into(),
        reply,
    })
    .await
}
