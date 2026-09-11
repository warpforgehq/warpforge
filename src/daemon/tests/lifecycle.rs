use super::*;

#[tokio::test]
async fn successful_update_safety_check_stops_commands_queued_behind_it() {
    let daemon = Daemon::spawn(Vec::new(), None);
    let (safety_tx, safety_rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::UpdateSafety { reply: safety_tx })
        .await;

    let (task_tx, task_rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::CreateTask {
            project: "demo".into(),
            prompt: "must not start".into(),
            agent: "claude".into(),
            tags: Vec::new(),
            include_runtime_context: false,
            worktree: false,
            parent_task_id: None,
            attachments: Vec::new(),
            default_model: None,
            config_overrides: std::collections::HashMap::new(),
            backlog_item_id: None,
            origin: None,
            start: true,
            reply: task_tx,
        })
        .await;

    assert!(safety_rx.await.unwrap().is_empty());
    assert!(
        task_rx.await.is_err(),
        "the actor must drop mutations queued after an accepted handoff"
    );
}

/// Shutting a daemon down must not kill processes it never started.
///
/// Teardown used to sweep the project's whole port range with `lsof` and
/// kill every listener in it. Every test that shuts a daemon down did that
/// too — so `cargo test` in this repo killed whatever the developer had
/// listening on 4000-4099, including the agent processes of the warpforge
/// running the tests.
#[tokio::test]
async fn shutdown_does_not_kill_listeners_it_did_not_start() {
    // A stranger's server on a port inside the project's range. Spawned as
    // a child process so the sweep would kill it, not the test runner.
    let (start, end) = (4000u16, 4099u16);
    let port = (start..=end)
        .find(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok())
        .expect("a free port in the project range");
    let mut stranger = tokio::process::Command::new("python3")
        .args([
            "-c",
            &format!(
                "import socket,time\ns=socket.socket()\ns.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\ns.bind(('127.0.0.1',{port}))\ns.listen()\ntime.sleep(30)"
            ),
        ])
        .spawn()
        .expect("spawn the stranger");

    // Wait until it is actually listening.
    let mut listening = false;
    for _ in 0..100 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            listening = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        listening,
        "the stranger should be listening before we start"
    );

    let daemon = Daemon::spawn(test_projects(), None);
    daemon.shutdown().await;

    assert!(
        stranger.try_wait().expect("poll the stranger").is_none(),
        "daemon shutdown killed a process it never started"
    );
    stranger.kill().await.ok();
}
