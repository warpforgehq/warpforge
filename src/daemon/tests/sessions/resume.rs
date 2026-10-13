use super::*;

/// Regression: when a stale ACP handle is in sessions and a prompt
/// arrives, the daemon must detect the dead handle and trigger resume
/// via the stored session_id rather than failing with "no live session".
#[tokio::test]
async fn stale_handle_prompt_triggers_resume() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let log_path = dir.path().join("acp.log");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-recovery.mjs"
    );
    let session_id = "persisted-session-42";
    let agent = format!("node {} {} {}", fixture, log_path.display(), session_id);
    let store = Store::open_at(&db_path).unwrap();
    let mut persisted = Task::new("demo", "original prompt", &agent, vec![]);
    persisted.attach_session(session_id.into());
    persisted.blocked_reason = Some("previous process exited".into());
    persisted.set_status(TaskStatus::Blocked);
    let task_id = persisted.id.clone();
    store.upsert_task(&persisted).unwrap();

    let daemon = Daemon::spawn(test_projects(), Some(store));
    let mut events = daemon.subscribe();
    daemon
        .session_prompt(&task_id, "follow up after recovery", vec![])
        .await
        .unwrap();
    timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Waiting {
                    break;
                }
            }
        }
    })
    .await
    .expect("resumed prompt should complete");

    let log = std::fs::read_to_string(&log_path).unwrap();
    let calls: Vec<serde_json::Value> = log
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let load = calls
        .iter()
        .find(|call| call["method"] == "session/load")
        .expect("recovery must call session/load");
    assert_eq!(load["params"]["sessionId"], session_id);
    let prompt = calls
        .iter()
        .find(|call| call["method"] == "session/prompt")
        .expect("follow-up must be delivered after load");
    assert_eq!(prompt["params"]["sessionId"], session_id);
    let tasks = daemon.tasks().await;
    assert_eq!(
        tasks
            .iter()
            .find(|task| task.id == task_id)
            .unwrap()
            .session_id
            .as_deref(),
        Some(session_id)
    );

    daemon.shutdown().await;
    let store = Store::open_at(&db_path).unwrap();
    let user_messages = store
        .load_session_updates(&task_id)
        .unwrap()
        .into_iter()
        .filter(|update| matches!(update, warpforge_protocol::SessionUpdate::UserMessage { text, .. } if text == "follow up after recovery"))
        .count();
    assert_eq!(user_messages, 1, "reconnect must persist the prompt once");
}

/// A Claude session's transcript lives in the config dir it was started in.
/// Resuming must go back there even after the configured dir changed —
/// anywhere else the agent finds nothing and the session is dropped as lost.
#[tokio::test]
async fn a_claude_resume_runs_in_the_dir_its_session_was_started_in() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let log_path = dir.path().join("acp.log");
    let env_out = dir.path().join("claude-config-dir");
    let pinned = dir.path().join("claude-pinned");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-recovery.mjs"
    );
    let session_id = "pinned-session";
    let store = Store::open_at(&db_path).unwrap();
    store
        .save_agents(&[warpforge_protocol::AgentConfig {
            id: "claude".into(),
            display_name: "Claude".into(),
            acp_command: format!(
                "printf '%s' \"$CLAUDE_CONFIG_DIR\" > {}; exec node {} {} {}",
                env_out.display(),
                fixture,
                log_path.display(),
                session_id
            ),
            enabled: false,
            models: vec![],
            last_model: None,
        }])
        .unwrap();
    let mut persisted = Task::new("demo", "original prompt", "claude", vec![]);
    persisted.attach_session(session_id.into());
    persisted.claude_config_dir = Some(pinned.to_string_lossy().into_owned());
    persisted.set_status(TaskStatus::Interrupted);
    let task_id = persisted.id.clone();
    store.upsert_task(&persisted).unwrap();

    let daemon = Daemon::spawn(test_projects(), Some(store));
    let mut events = daemon.subscribe();
    daemon
        .session_prompt(&task_id, "follow up", vec![])
        .await
        .unwrap();
    timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Waiting {
                    break;
                }
            }
        }
    })
    .await
    .expect("resumed prompt should complete");

    assert_eq!(
        std::fs::read_to_string(&env_out).unwrap(),
        pinned.to_string_lossy()
    );
    daemon.shutdown().await;
    let reloaded = Store::open_at(&db_path)
        .unwrap()
        .load_tasks()
        .unwrap()
        .into_iter()
        .find(|task| task.id == task_id)
        .unwrap();
    assert_eq!(
        reloaded.claude_config_dir.as_deref(),
        Some(pinned.to_string_lossy().as_ref())
    );
}

/// An agent that has forgotten a saved session can never resume it. The
/// daemon must say so in a form the client can act on, and must drop the
/// dead id — keeping it made every later prompt fail the same way.
#[tokio::test]
async fn a_forgotten_session_is_marked_lost_and_its_id_dropped() {
    use warpforge_protocol as wire;

    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let log_path = dir.path().join("acp.log");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-session-lost.mjs"
    );
    let agent = format!("node {} {}", fixture, log_path.display());
    let store = Store::open_at(&db_path).unwrap();
    let mut persisted = Task::new("demo", "original prompt", &agent, vec![]);
    persisted.attach_session("gone-session".into());
    persisted.set_status(TaskStatus::Interrupted);
    let task_id = persisted.id.clone();
    store.upsert_task(&persisted).unwrap();

    let daemon = Daemon::spawn(test_projects(), Some(store));
    let mut events = daemon.subscribe();
    daemon
        .session_prompt(&task_id, "follow up", vec![])
        .await
        .unwrap();
    let blocked = timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Blocked {
                    break task;
                }
            }
        }
    })
    .await
    .expect("a rejected load should block the task");

    assert_eq!(
        blocked.blocked_kind,
        Some(wire::TaskBlockedKind::SessionLost)
    );
    assert_eq!(blocked.session_id, None, "the dead id must not be kept");

    // The classification has to survive a restart: the task stays blocked
    // across daemon lifetimes, so the client needs it again on reload.
    daemon.shutdown().await;
    let store = Store::open_at(&db_path).unwrap();
    let reloaded = store
        .load_tasks()
        .unwrap()
        .into_iter()
        .find(|task| task.id == task_id)
        .expect("task should still be stored");
    assert_eq!(
        reloaded.blocked_kind,
        Some(wire::TaskBlockedKind::SessionLost)
    );
    assert_eq!(reloaded.session_id, None);
}

/// A rejected initialize must carry the agent's own words. The missing native
/// binary is the difference between "reinstall" and a dead end, and dropping
/// the error object is exactly how that reason used to vanish.
#[tokio::test]
async fn initialize_rejection_surfaces_the_agent_error_message() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    let mock = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-reject-init.mjs"
    );
    let agent = format!("node {mock}");
    let task_id = daemon
        .create_task(
            "demo",
            "fix the thing",
            &agent,
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

    let blocked = timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Blocked {
                    break task;
                }
            }
        }
    })
    .await
    .expect("an initialize rejection should block the task");

    let reason = blocked.blocked_reason.unwrap_or_default();
    assert!(
        reason.contains("rejected the ACP initialize request"),
        "the report should name the handshake step: {reason}"
    );
    assert!(
        reason.contains("Missing optional dependency @openai/codex-darwin-arm64"),
        "the agent's own error must survive: {reason}"
    );
}
