use super::*;
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

fn test_projects() -> Vec<ProjectEntry> {
    vec![ProjectEntry {
        name: "demo".to_string(),
        path: ".".to_string(),
        added_at: "0".to_string(),
        port_range: None,
        port_range_override: None,
    }]
}

// ── Workflow pipeline engine ──

const WF_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-workflow.mjs"
);

/// A tempdir project with one workflow file at
/// `.warpforge/workflows/test.yaml` and a registered `demo` project entry.
fn workflow_project(yaml: &str) -> (tempfile::TempDir, Vec<ProjectEntry>) {
    let dir = tempfile::tempdir().unwrap();
    let wf_dir = dir.path().join(".warpforge/workflows");
    std::fs::create_dir_all(&wf_dir).unwrap();
    std::fs::write(wf_dir.join("test.yaml"), yaml).unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    (dir, projects)
}

/// Scripted mock-agent command sharing `state` across stage processes.
fn wf_agent(dir: &tempfile::TempDir, state: &str, script: &str) -> String {
    format!(
        "node {WF_FIXTURE} {} {script}",
        dir.path().join(state).display()
    )
}

async fn create_workflow_task(daemon: &DaemonHandle, agent: &str) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::CreateWorkflowTask {
            project: "demo".into(),
            prompt: "do the thing".into(),
            agent: agent.into(),
            tags: vec![],
            worktree: false,
            workflow: "test".into(),
            attachments: vec![],
            default_model: None,
            include_runtime_context: false,
            config_overrides: std::collections::HashMap::new(),
            parent_task_id: None,
            reply: tx,
        })
        .await;
    rx.await.unwrap().expect("workflow task created")
}

/// Drive the event stream until the parent task satisfies `pred`.
async fn wait_for_parent(
    events: &mut tokio::sync::broadcast::Receiver<Event>,
    parent_id: &str,
    what: &str,
    pred: impl Fn(&Task) -> bool,
) -> Task {
    timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(Event::TaskUpdated(task)) = events.recv().await {
                if task.id == parent_id && pred(&task) {
                    break task;
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for: {what}"))
}

mod lifecycle;
mod sessions;
mod tasks;
mod workflow;
mod workflow_control;
