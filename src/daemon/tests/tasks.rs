use super::*;

#[tokio::test]
async fn create_task_generates_distinct_id_and_no_session() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    let id = daemon
        .create_task(
            "demo",
            "fix the bug",
            "claude",
            vec!["bug".into()],
            false,
            false,
            None,
            vec![],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;

    assert!(id.starts_with("t_"), "task id looks like a task id: {id}");

    // The TaskCreated event carries a task whose session_id is None and
    // whose session identifier is NOT the task id — they are separate.
    // Wait for TaskCreated specifically rather than the next event: startup
    // work broadcasts too (the quota poller emits once even with no accounts
    // configured), and whichever lands first is a race.
    let task = loop {
        let ev = timeout(Duration::from_secs(1), events.recv())
            .await
            .expect("TaskCreated within 1s")
            .expect("event");
        if let Event::TaskCreated(task) = ev {
            break task;
        }
    };
    assert_eq!(task.id, id);
    assert_eq!(task.session_id, None);
    assert_eq!(task.status, TaskStatus::Queued);
    assert_eq!(task.prompt, "fix the bug");

    let tasks = daemon.tasks().await;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, id);
}

#[tokio::test]
async fn session_id_stays_separate_from_task_id_when_attached() {
    // A task can attach a session without the two ids ever being unified —
    // this is what keeps multi-agent-per-task additive later.
    let mut task = Task::new("demo", "p", "claude", vec![]);
    let task_id = task.id.clone();
    task.attach_session("sess-xyz".to_string());
    assert_eq!(task.id, task_id);
    assert_eq!(task.session_id.as_deref(), Some("sess-xyz"));
    assert_ne!(task.session_id.as_deref(), Some(task_id.as_str()));
    assert_eq!(task.status, TaskStatus::Running);
}

#[tokio::test]
async fn cancel_task_marks_waiting() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let id = daemon
        .create_task(
            "demo",
            "p",
            "claude",
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
    let mut events = daemon.subscribe();

    daemon.cancel_task(&id).await.expect("cancel accepted");

    timeout(Duration::from_secs(1), async {
        loop {
            match events.recv().await.expect("event") {
                Event::TaskUpdated(task) if task.id == id && task.status == TaskStatus::Waiting => {
                    break;
                }
                _ => continue,
            }
        }
    })
    .await
    .expect("TaskUpdated with Idle status");
}

/// Regression: child command-not-found exits before initialize. The task
/// must go Blocked with an actionable error (not hang in Queued).
#[tokio::test]
async fn child_command_not_found_surfaces_error() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    let task_id = daemon
        .create_task(
            "demo",
            "fix the bug",
            "nonexistent-acp-agent-test-xyz-$$",
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

    let blocked_reason = timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == task_id && task.status == TaskStatus::Blocked {
                    break task.blocked_reason.unwrap_or_default();
                }
            }
        }
    })
    .await
    .expect("command-not-found should block promptly");
    assert!(blocked_reason.contains("nonexistent-acp-agent-test-xyz-$$"));
    assert!(blocked_reason.contains("127"), "{blocked_reason}");
    assert!(blocked_reason.to_ascii_lowercase().contains("not found"));
    assert!(!blocked_reason.contains('\x1b'));

    let mut duplicate_failures = 0;
    while let Ok(Ok(event)) = timeout(Duration::from_millis(200), events.recv()).await {
        if matches!(event, Event::TaskUpdated(ref task) if task.id == task_id && task.status == TaskStatus::Blocked)
        {
            duplicate_failures += 1;
        }
    }
    assert_eq!(
        duplicate_failures, 0,
        "failure must be notified exactly once"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn task_delete_stops_the_active_process_before_removing_history() {
    let (dir, projects) = workflow_project("name: Delete flow\n");
    let pid_path = dir.path().join("delete.pid");
    let lead = format!(
        "echo $$ > {}; exec {}",
        pid_path.display(),
        wf_agent(&dir, "delete.state", "slow-impl")
    );
    let daemon = Daemon::spawn(
        projects,
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let parent_id = create_workflow_task(&daemon, &lead).await;

    let pid = timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_path) {
                let pid = pid.trim();
                if pid.parse::<u32>().is_ok() {
                    break pid.to_string();
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("active stage should write its process id");

    daemon
        .delete_task(&parent_id)
        .await
        .expect("task deletion acknowledged");

    let process_alive = tokio::process::Command::new("kill")
        .args(["-0", &pid])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success());
    assert!(
        !process_alive,
        "task.delete acknowledged before ACP process {pid} exited"
    );
    assert!(
        daemon.tasks().await.iter().all(|task| task.id != parent_id),
        "deleted task remained in the daemon task list"
    );
}
