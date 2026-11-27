use super::*;
use warpforge_protocol as wire;

const REJECT_INIT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-reject-init.mjs"
);
const BROKEN: &str = "Error: Missing optional dependency @openai/codex-darwin-arm64";

/// A configured agent that is not probed: disabled agents are never probed,
/// so every health event in a test comes from what the test itself does.
fn mock_agent(acp_command: String) -> wire::AgentConfig {
    wire::AgentConfig {
        id: "mock-agent".into(),
        display_name: "Mock Agent".into(),
        acp_command,
        enabled: false,
        models: vec![],
        last_model: None,
    }
}

async fn next_health(
    events: &mut tokio::sync::broadcast::Receiver<Event>,
    agent: &str,
) -> Option<bool> {
    timeout(Duration::from_millis(500), async {
        loop {
            if let Ok(Event::AgentHealthUpdated { id, broken }) = events.recv().await {
                if id == agent {
                    return broken.is_some();
                }
            }
        }
    })
    .await
    .ok()
}

/// Enabling an agent with no cached models probes it with `reply: None`.
#[tokio::test]
async fn a_background_probe_marks_a_broken_install_and_a_healthy_one_clears_it() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    let config = |acp_command: String| wire::AgentConfig {
        id: "mock-agent".into(),
        display_name: "Mock Agent".into(),
        acp_command,
        enabled: true,
        models: vec![],
        last_model: None,
    };

    daemon
        .update_agents(vec![config(format!("node {REJECT_INIT}"))])
        .await;

    let broken = timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(Event::AgentHealthUpdated { id, broken }) = events.recv().await {
                if id == "mock-agent" {
                    break broken;
                }
            }
        }
    })
    .await
    .expect("a background probe with a broken-install signature should mark the agent")
    .expect("expected the agent to be marked broken, not cleared");
    assert!(broken.summary.contains("Missing optional dependency"));

    // Re-point at a fixture that completes the handshake; enabling it again
    // re-probes (still no cached models) and must clear the earlier mark.
    let healthy_mock = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-inspect.mjs"
    );
    daemon
        .update_agents(vec![config(format!("node {healthy_mock}"))])
        .await;

    let cleared = timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(Event::AgentHealthUpdated { id, broken }) = events.recv().await {
                if id == "mock-agent" {
                    break broken;
                }
            }
        }
    })
    .await
    .expect("a successful probe should clear the earlier mark");
    assert!(cleared.is_none());
}

/// A session start that fails with a broken-install signature (the agent's
/// own process reports a missing native binary or module) must mark the
/// agent's tracked health, exactly like a failed background probe does.
#[tokio::test]
async fn a_session_start_failure_with_a_broken_install_signature_marks_the_agent() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    daemon
        .update_agents(vec![mock_agent(format!("node {REJECT_INIT}"))])
        .await;
    let agent = "mock-agent".to_string();
    daemon
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

    let broken = timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(Event::AgentHealthUpdated { id, broken }) = events.recv().await {
                if id == agent {
                    break broken;
                }
            }
        }
    })
    .await
    .expect("a session start with a broken-install signature should mark the agent")
    .expect("expected the agent to be marked broken, not cleared");
    assert!(broken.summary.contains("Missing optional dependency"));
}

/// A session start that fails for an unrelated reason (here: an auth error —
/// the same non-signature the install-verification classifier already
/// ignores) must not be mistaken for a broken install.
#[tokio::test]
async fn a_session_start_auth_failure_does_not_mark_the_agent_broken() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();

    daemon
        .update_agents(vec![mock_agent(format!(
            "node {REJECT_INIT} 'Authentication required' -32000"
        ))])
        .await;
    let agent = "mock-agent".to_string();
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

    // Wait for the task to actually block — proving the session-start path
    // ran to completion — before checking that no health event followed it.
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
    .expect("an initialize rejection should still block the task");
    assert!(blocked
        .blocked_reason
        .unwrap_or_default()
        .contains("Authentication required"));

    let saw_health = timeout(Duration::from_millis(500), async {
        loop {
            if let Ok(Event::AgentHealthUpdated { id, .. }) = events.recv().await {
                if id == agent {
                    return true;
                }
            }
        }
    })
    .await
    .unwrap_or(false);
    assert!(
        !saw_health,
        "an auth failure must not be classified as a broken install"
    );
}

/// The probe context an install verifies with must resolve for a known agent
/// even before it is configured, and be absent for one the daemon never heard
/// of. This is the path `agents.install` verification rides.
#[tokio::test]
async fn agent_probe_context_resolves_a_default_command_for_a_known_agent() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let context = daemon
        .agent_probe_context("claude")
        .await
        .expect("a known agent should resolve a probe context");
    assert_eq!(context.acp_command, "claude-agent-acp --acp");
    assert!(daemon.agent_probe_context("nope").await.is_none());
}

/// Detection takes seconds; a mark made while it ran must reach its result.
#[tokio::test]
async fn detection_reports_the_health_held_when_it_finishes() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    daemon
        .observe_agent_health("mock-agent", Err(BROKEN.to_string()))
        .await;

    let detected = wire::DetectedAgent {
        id: "mock-agent".into(),
        display_name: "Mock Agent".into(),
        installed: true,
        default_acp_command: "mock".into(),
        install_hint: String::new(),
        version: None,
        latest_version: None,
        status: "unknown".into(),
        install_command: None,
        update_command: None,
        can_manage: false,
        can_reinstall: false,
        broken_install: None,
    };
    let (reply, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::AgentsDetected {
            detected: vec![detected],
            reply,
        })
        .await;
    let detected = rx.await.unwrap();
    assert!(detected[0].broken_install.is_some());
}

/// A probe that started before a reinstall tested the old install.
#[tokio::test]
async fn a_probe_from_before_a_reinstall_does_not_re_mark_the_agent() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();
    daemon.observe_agent_health("mock-agent", Ok(())).await;

    let failed = |generation| Command::AgentProbeFailed {
        id: "mock-agent".into(),
        error: BROKEN.to_string(),
        generation,
    };
    daemon.send(failed(0)).await;
    assert_eq!(next_health(&mut events, "mock-agent").await, None);

    daemon.send(failed(1)).await;
    assert_eq!(next_health(&mut events, "mock-agent").await, Some(true));
}
