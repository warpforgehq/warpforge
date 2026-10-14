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
    persisted.claude_config_dir = Some(crate::daemon::claude_config::ClaudeDir {
        path: pinned.clone(),
        explicit: true,
    });
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
        reloaded.claude_config_dir,
        Some(crate::daemon::claude_config::ClaudeDir {
            path: pinned,
            explicit: true,
        })
    );
}

/// A `claude` agent backed by `fixture` that first writes the
/// `CLAUDE_CONFIG_DIR` it was started with to `env_out`.
fn env_reporting_claude(
    env_out: &std::path::Path,
    fixture: &str,
    args: &str,
) -> warpforge_protocol::AgentConfig {
    warpforge_protocol::AgentConfig {
        id: "claude".into(),
        display_name: "Claude".into(),
        acp_command: format!(
            "printf '%s' \"$CLAUDE_CONFIG_DIR\" > {}; exec node {fixture} {args}",
            env_out.display()
        ),
        enabled: false,
        models: vec![],
        last_model: None,
    }
}

async fn wait_for_waiting(
    events: &mut tokio::sync::broadcast::Receiver<Event>,
    task_id: &str,
) -> Task {
    timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Waiting {
                    break task;
                }
            }
        }
    })
    .await
    .expect("the turn should complete")
}

/// What a spawn with no pin runs in, and what the agent is told.
fn current_dir_and_env() -> (crate::daemon::claude_config::ClaudeDir, String) {
    let dir = crate::daemon::claude_config::config_dir();
    let env = if dir.explicit {
        dir.path.to_string_lossy().into_owned()
    } else {
        String::new()
    };
    (dir, env)
}

/// A session that resumes with no dir recorded — an external session, or one
/// from before dirs were recorded — runs in the current dir, and that becomes
/// its recorded home, so a later change of setting cannot strand it.
#[tokio::test]
async fn an_unrecorded_claude_resume_records_the_dir_it_ran_in() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let env_out = dir.path().join("claude-config-dir");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-recovery.mjs"
    );
    let log = dir.path().join("acp.log");
    let store = Store::open_at(&db_path).unwrap();
    store
        .save_agents(&[env_reporting_claude(
            &env_out,
            fixture,
            &format!("{} legacy-session", log.display()),
        )])
        .unwrap();
    let mut persisted = Task::new("demo", "original prompt", "claude", vec![]);
    persisted.attach_session("legacy-session".into());
    persisted.set_status(TaskStatus::Interrupted);
    let task_id = persisted.id.clone();
    store.upsert_task(&persisted).unwrap();

    let daemon = Daemon::spawn(test_projects(), Some(store));
    let mut events = daemon.subscribe();
    daemon
        .session_prompt(&task_id, "follow up", vec![])
        .await
        .unwrap();
    let task = wait_for_waiting(&mut events, &task_id).await;

    let (current, env) = current_dir_and_env();
    assert_eq!(std::fs::read_to_string(&env_out).unwrap(), env);
    assert_eq!(task.claude_config_dir, Some(current));
    daemon.shutdown().await;
}

/// A fresh session starts in the configured dir and records it, replacing a
/// pin left from a session that no longer exists.
#[tokio::test]
async fn a_fresh_claude_session_records_the_current_dir_over_a_stale_pin() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let env_out = dir.path().join("claude-config-dir");
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-agent-noedit.mjs"
    );
    let store = Store::open_at(&db_path).unwrap();
    store
        .save_agents(&[env_reporting_claude(&env_out, fixture, "")])
        .unwrap();
    let mut persisted = Task::new("demo", "original prompt", "claude", vec![]);
    persisted.claude_config_dir = Some(crate::daemon::claude_config::ClaudeDir {
        path: dir.path().join("stale"),
        explicit: true,
    });
    persisted.set_status(TaskStatus::Blocked);
    let task_id = persisted.id.clone();
    store.upsert_task(&persisted).unwrap();

    let daemon = Daemon::spawn(test_projects(), Some(store));
    let mut events = daemon.subscribe();
    daemon
        .session_prompt(&task_id, "start over", vec![])
        .await
        .unwrap();
    let task = wait_for_waiting(&mut events, &task_id).await;

    let (current, env) = current_dir_and_env();
    assert_eq!(std::fs::read_to_string(&env_out).unwrap(), env);
    assert_eq!(task.claude_config_dir, Some(current.clone()));
    daemon.shutdown().await;
    let reloaded = Store::open_at(&db_path)
        .unwrap()
        .load_tasks()
        .unwrap()
        .into_iter()
        .find(|task| task.id == task_id)
        .unwrap();
    assert_eq!(reloaded.claude_config_dir, Some(current));
}

/// Explicitness is stored, not re-derived from the path: `~/.claude` named by
/// the daemon's own `CLAUDE_CONFIG_DIR` is explicit to the CLI, and the
/// opposite pairing must survive a restart just as well.
#[test]
fn a_recorded_claude_dir_keeps_its_explicitness_across_a_restart() {
    use crate::daemon::claude_config::ClaudeDir;
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("warpforge.db");
    let home = dirs::home_dir().unwrap();
    let cases = [
        ClaudeDir {
            path: home.join(".claude"),
            explicit: true,
        },
        ClaudeDir {
            path: dir.path().join("elsewhere"),
            explicit: false,
        },
    ];
    let store = Store::open_at(&db_path).unwrap();
    let ids: Vec<String> = cases
        .iter()
        .map(|case| {
            let mut task = Task::new("demo", "p", "claude", vec![]);
            task.claude_config_dir = Some(case.clone());
            store.upsert_task(&task).unwrap();
            task.id
        })
        .collect();
    drop(store);
    let loaded = Store::open_at(&db_path).unwrap().load_tasks().unwrap();
    for (id, case) in ids.iter().zip(cases) {
        let task = loaded.iter().find(|task| &task.id == id).unwrap();
        assert_eq!(task.claude_config_dir, Some(case));
    }
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
