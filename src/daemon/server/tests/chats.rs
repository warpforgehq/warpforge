//! Chats: tasks with no project, run in their own folder.

use super::*;
use crate::daemon::scratch;
use crate::daemon::{Daemon, Store};
use std::time::Duration;

const TOUCH_AGENT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-touch.mjs"
);

async fn call(
    handle: &DaemonHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, wire::RpcError> {
    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::External));
    let method: wire::Method = serde_json::from_value(request).unwrap();
    dispatch(handle, method, &lifecycle).await
}

async fn create_chat(handle: &DaemonHandle, start: bool) -> String {
    let created = call(
        handle,
        json!({
            "method": "task.create",
            "params": {
                "kind": "chat",
                "project": "demo",
                "prompt": "hello",
                "agent": format!("node {TOUCH_AGENT}"),
                "worktree": true,
                "start": start,
            }
        }),
    )
    .await
    .expect("chat created");
    created["taskId"].as_str().unwrap().to_string()
}

async fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while !done() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

fn spawn() -> DaemonHandle {
    Daemon::spawn(
        Vec::new(),
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    )
}

#[tokio::test]
async fn a_chat_runs_in_its_own_folder_without_a_project() {
    let handle = spawn();
    let id = create_chat(&handle, true).await;
    let dir = scratch::chat_dir(&id);
    let touched = dir.join("touched.txt");
    wait_for("the agent's file", || touched.exists()).await;

    let task = handle
        .tasks()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .unwrap();
    assert_eq!(task.kind, wire::TaskKind::Chat);
    assert_eq!(task.project, "");
    assert!(task.worktree.is_none(), "a chat never gets a worktree");
    let cwd = std::fs::read_to_string(&touched).unwrap();
    assert_eq!(
        std::path::Path::new(&cwd).canonicalize().unwrap(),
        dir.canonicalize().unwrap()
    );

    let folder = call(
        &handle,
        json!({ "method": "chat.folder", "params": { "task_id": id } }),
    )
    .await
    .unwrap();
    assert_eq!(folder["fileCount"], 1);
    assert_eq!(folder["path"], dir.to_string_lossy().as_ref());
    handle.shutdown().await;
}

#[tokio::test]
async fn deleting_a_chat_keeps_its_files_unless_asked() {
    let handle = spawn();
    let kept = create_chat(&handle, false).await;
    let removed = create_chat(&handle, false).await;
    let empty = create_chat(&handle, false).await;
    for id in [&kept, &removed] {
        std::fs::write(scratch::chat_dir(id).join("notes.md"), "mine").unwrap();
    }
    assert!(scratch::chat_dir(&empty).is_dir(), "created with the chat");

    for (id, delete_folder) in [(&kept, false), (&removed, true), (&empty, false)] {
        call(
            &handle,
            json!({ "method": "task.delete", "params": { "task_id": id, "delete_folder": delete_folder } }),
        )
        .await
        .expect("deleted");
    }

    assert!(scratch::chat_dir(&kept).join("notes.md").exists());
    assert!(!scratch::chat_dir(&removed).exists());
    let empty_dir = scratch::chat_dir(&empty);
    wait_for("the empty folder to go", || !empty_dir.exists()).await;
    assert!(handle.tasks().await.is_empty());
    handle.shutdown().await;
}

#[tokio::test]
async fn a_chat_cannot_run_a_workflow() {
    let handle = spawn();
    let error = call(
        &handle,
        json!({
            "method": "task.create",
            "params": {
                "kind": "chat",
                "project": "",
                "prompt": "hello",
                "agent": "claude",
                "workflow": "default",
            }
        }),
    )
    .await
    .expect_err("refused");
    assert_eq!(error.code, wire::ErrorCode::InvalidRequest);
    assert!(handle.tasks().await.is_empty());
    handle.shutdown().await;
}
