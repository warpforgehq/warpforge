use super::*;

#[tokio::test]
async fn acp_session_streams_updates_and_permission_roundtrip() {
    use warpforge_protocol as wire;

    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    // Agent is a raw command (not a template): our mock ACP agent.
    let mock = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-agent.mjs"
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

    let mut saw_running = false;
    let mut saw_agent_text = false;
    let mut saw_file_edit = false;
    let mut saw_detailed_file_edit = false;
    let mut permission_request_id: Option<String> = None;
    let mut saw_turn_ended = false;
    let mut saw_waiting = false;
    let mut waiting_files_changed = 0u32;
    let mut answered = false;

    // Drive the event stream to completion of one turn.
    for _ in 0..60 {
        let ev = match timeout(Duration::from_secs(5), events.recv()).await {
            Ok(Ok(ev)) => ev,
            _ => break,
        };
        match ev {
            Event::TaskUpdated(t) if t.id == task_id => {
                if t.status == TaskStatus::Running {
                    saw_running = true;
                }
                if t.status == TaskStatus::Waiting {
                    saw_waiting = true;
                    waiting_files_changed = t.files_changed;
                }
            }
            Event::SessionUpdate {
                task_id: tid,
                update,
            } if tid == task_id => match update {
                wire::SessionUpdate::AgentText { .. } => saw_agent_text = true,
                wire::SessionUpdate::FileEdit { path, hunks, .. } => {
                    assert_eq!(path, "src/main.rs");
                    saw_file_edit = true;
                    saw_detailed_file_edit |= !hunks.is_empty();
                }
                wire::SessionUpdate::PermissionRequest {
                    request_id,
                    options,
                    ..
                } => {
                    assert!(options.contains(&"allow".to_string()));
                    permission_request_id = Some(request_id);
                }
                wire::SessionUpdate::TurnEnded { .. } => saw_turn_ended = true,
                _ => {}
            },
            _ => {}
        }

        // Once the agent asks, answer "allow" so it can finish the turn.
        if !answered {
            if let Some(rid) = permission_request_id.clone() {
                daemon.session_permission(&task_id, &rid, "allow").await;
                answered = true;
            }
        }

        if saw_turn_ended && saw_waiting {
            break;
        }
    }

    assert!(
        saw_running,
        "task should go Running when the session starts"
    );
    assert!(saw_agent_text, "should stream agent text");
    assert!(saw_file_edit, "should report the file edit");
    assert!(
        saw_detailed_file_edit,
        "should preserve ACP diff hunks in the session stream"
    );
    assert!(
        permission_request_id.is_some(),
        "should surface a permission request"
    );
    assert!(answered, "should have answered the permission");
    assert!(
        saw_turn_ended,
        "turn should end after the permission is answered"
    );
    assert!(saw_waiting, "task should land in Waiting after the turn");
    // "There is something to review" is a fact about the diff, not a
    // separate lifecycle state — this turn edited a file, so it shows up
    // here rather than as a distinct status.
    assert!(
        waiting_files_changed > 0,
        "an editing turn should park in Waiting with changes recorded"
    );
}

#[tokio::test]
async fn no_edit_turn_lands_in_waiting_with_no_changes() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    let mock = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-agent-noedit.mjs"
    );
    let agent = format!("node {mock}");
    let task_id = daemon
        .create_task(
            "demo",
            "what port is the api on?",
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

    let mut saw_running = false;
    let mut final_status: Option<TaskStatus> = None;
    let mut final_files_changed = 0u32;
    for _ in 0..60 {
        let ev = match timeout(Duration::from_secs(5), events.recv()).await {
            Ok(Ok(ev)) => ev,
            _ => break,
        };
        if let Event::TaskUpdated(t) = ev {
            if t.id == task_id {
                if t.status == TaskStatus::Running {
                    saw_running = true;
                }
                // The turn settles into a non-running, non-queued status.
                if matches!(t.status, TaskStatus::Waiting | TaskStatus::Blocked) {
                    final_files_changed = t.files_changed;
                    final_status = Some(t.status.clone());
                    break;
                }
            }
        }
    }

    assert!(saw_running, "task should go Running during the turn");
    assert_eq!(
        final_status,
        Some(TaskStatus::Waiting),
        "a finished turn parks in Waiting whether or not it edited anything"
    );
    assert_eq!(
        final_files_changed, 0,
        "a pure Q&A turn has nothing to review, and that is a field, not a status"
    );
}

#[tokio::test]
async fn acp_prompt_blocks_follow_capabilities_and_support_followups() {
    use warpforge_protocol::PromptAttachment;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("note.txt"), "attached text").unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let daemon = Daemon::spawn(
        projects,
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let mut events = daemon.subscribe();
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-inspect.mjs"
    );
    let task_id = daemon
        .create_task(
            "demo",
            "inspect",
            &format!("node {fixture} true true"),
            vec![],
            false,
            false,
            None,
            vec![
                PromptAttachment::File {
                    path: "note.txt".into(),
                    range: None,
                },
                PromptAttachment::Image {
                    name: "tiny.png".into(),
                    mime_type: "image/png".into(),
                    data: "iVBORw0KGgpyZXN0".into(),
                },
                PromptAttachment::Document {
                    name: "spec.md".into(),
                    mime_type: "text/markdown".into(),
                    text: "# spec".into(),
                },
            ],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    let mut initial = false;
    for _ in 0..20 {
        if let Ok(Ok(Event::SessionUpdate {
            task_id: id,
            update: warpforge_protocol::SessionUpdate::AgentText { text },
        })) = timeout(Duration::from_secs(2), events.recv()).await
        {
            if id == task_id && text == "blocks:text,resource,image,resource" {
                initial = true;
                break;
            }
        }
    }
    assert!(
        initial,
        "initial prompt should use resource, image and document blocks"
    );
    daemon
        .session_prompt(
            &task_id,
            "follow up",
            vec![
                PromptAttachment::File {
                    path: "note.txt".into(),
                    range: None,
                },
                PromptAttachment::Document {
                    name: "spec.md".into(),
                    mime_type: "text/markdown".into(),
                    text: "# spec".into(),
                },
            ],
        )
        .await
        .unwrap();
    let mut followup = false;
    for _ in 0..20 {
        if let Ok(Ok(Event::SessionUpdate {
            task_id: id,
            update: warpforge_protocol::SessionUpdate::AgentText { text },
        })) = timeout(Duration::from_secs(2), events.recv()).await
        {
            if id == task_id && text == "blocks:text,resource,resource" {
                followup = true;
                break;
            }
        }
    }
    assert!(followup, "follow-up attachments should reach ACP");
}

#[tokio::test]
async fn acp_resource_falls_back_to_text_and_unsupported_images_block() {
    use warpforge_protocol::PromptAttachment;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("note.txt"), "attached text").unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let fixture = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-inspect.mjs"
    );

    let daemon = Daemon::spawn(
        projects.clone(),
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let mut events = daemon.subscribe();
    let id = daemon
        .create_task(
            "demo",
            "inspect",
            &format!("node {fixture} true false"),
            vec![],
            false,
            false,
            None,
            vec![
                PromptAttachment::File {
                    path: "note.txt".into(),
                    range: None,
                },
                PromptAttachment::Document {
                    name: "spec.md".into(),
                    mime_type: "text/markdown".into(),
                    text: "# spec".into(),
                },
            ],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    let mut fallback = false;
    for _ in 0..20 {
        if let Ok(Ok(Event::SessionUpdate {
            task_id,
            update: warpforge_protocol::SessionUpdate::AgentText { text },
        })) = timeout(Duration::from_secs(2), events.recv()).await
        {
            if task_id == id && text == "blocks:text,text,text" {
                fallback = true;
                break;
            }
        }
    }
    assert!(
        fallback,
        "resources and documents should fall back to delimited text"
    );

    let daemon = Daemon::spawn(
        projects,
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let mut events = daemon.subscribe();
    let id = daemon
        .create_task(
            "demo",
            "inspect",
            &format!("node {fixture} false true"),
            vec![],
            false,
            false,
            None,
            vec![PromptAttachment::Image {
                name: "tiny.png".into(),
                mime_type: "image/png".into(),
                data: "iVBORw0KGgpyZXN0".into(),
            }],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    let mut blocked = false;
    for _ in 0..20 {
        if let Ok(Ok(Event::TaskUpdated(task))) =
            timeout(Duration::from_secs(2), events.recv()).await
        {
            if task.id == id && task.status == TaskStatus::Blocked {
                blocked = true;
                break;
            }
        }
    }
    assert!(blocked, "unsupported images must be rejected by the daemon");
    assert!(daemon
        .session_prompt("missing", "not delivered", vec![])
        .await
        .is_err());
}

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
