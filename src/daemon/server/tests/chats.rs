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
    let dir = scratch::chat_dir(&id).unwrap();
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
        std::fs::write(scratch::chat_dir(id).unwrap().join("notes.md"), "mine").unwrap();
    }
    assert!(
        scratch::chat_dir(&empty).unwrap().is_dir(),
        "created with the chat"
    );

    for (id, delete_folder) in [(&kept, false), (&removed, true), (&empty, false)] {
        call(
            &handle,
            json!({ "method": "task.delete", "params": { "task_id": id, "delete_folder": delete_folder } }),
        )
        .await
        .expect("deleted");
    }

    assert!(scratch::chat_dir(&kept).unwrap().join("notes.md").exists());
    assert!(!scratch::chat_dir(&removed).unwrap().exists());
    let empty_dir = scratch::chat_dir(&empty).unwrap();
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

#[tokio::test]
async fn a_task_continued_from_a_chat_gets_a_fresh_worktree() {
    let dir = tempfile::tempdir().unwrap();
    crate::daemon::diff::testsupport::init_repo(dir.path()).await;
    crate::daemon::diff::testsupport::git(
        dir.path(),
        &["commit", "-q", "--allow-empty", "-m", "i"],
    )
    .await;
    let projects = vec![crate::registry::ProjectEntry {
        name: "demo".into(),
        path: dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let handle = Daemon::spawn(
        projects,
        Store::open_at(std::path::Path::new(":memory:")).ok(),
    );
    let chat = create_chat(&handle, false).await;
    let created = call(
        &handle,
        json!({
            "method": "task.create",
            "params": {
                "project": "demo",
                "prompt": "carry on",
                "agent": format!("node {TOUCH_AGENT}"),
                "worktree": true,
                "tags": ["conversation-branch", format!("branched-from:{chat}")],
            }
        }),
    )
    .await
    .expect("task created");
    let id = created["taskId"].as_str().unwrap().to_string();

    let mut worktree = None;
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let task = handle
                .tasks()
                .await
                .into_iter()
                .find(|t| t.id == id)
                .unwrap();
            assert_ne!(
                task.status,
                crate::daemon::task::TaskStatus::Blocked,
                "{:?}",
                task.blocked_reason
            );
            if let Some(path) = task
                .worktree
                .filter(|p| std::path::Path::new(p).join("touched.txt").exists())
            {
                worktree = Some(path);
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the task ran in its own worktree");
    assert!(worktree.is_some());
    handle.shutdown().await;
}

#[tokio::test]
async fn deleting_with_its_folder_touches_only_a_chat_folder() {
    let handle = spawn();
    let victim = std::env::temp_dir().join(format!(
        "wf-victim-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    ));
    std::fs::create_dir_all(&victim).unwrap();
    std::fs::write(victim.join("keep.txt"), "mine").unwrap();
    let relative = format!("../{}", victim.file_name().unwrap().to_string_lossy());
    for id in [victim.to_string_lossy().into_owned(), relative] {
        let _ = call(
            &handle,
            json!({ "method": "task.delete", "params": { "task_id": id, "delete_folder": true } }),
        )
        .await;
        let _ = call(
            &handle,
            json!({ "method": "chat.folder", "params": { "task_id": id } }),
        )
        .await;
    }
    assert!(
        victim.join("keep.txt").exists(),
        "nothing outside a chat folder is removed"
    );

    let task = handle
        .create_task(
            "demo",
            "p",
            "claude",
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
    let lookalike = scratch::root().join(&task);
    std::fs::create_dir_all(&lookalike).unwrap();
    std::fs::write(lookalike.join("keep.txt"), "mine").unwrap();
    call(
        &handle,
        json!({ "method": "task.delete", "params": { "task_id": task, "delete_folder": true } }),
    )
    .await
    .expect("deleted");
    assert!(
        lookalike.join("keep.txt").exists(),
        "a task's delete never takes a folder"
    );
    let _ = std::fs::remove_dir_all(&lookalike);
    let _ = std::fs::remove_dir_all(&victim);

    let error = call(
        &handle,
        json!({ "method": "chat.folder", "params": { "task_id": "t_nope" } }),
    )
    .await
    .expect_err("no such chat");
    assert_eq!(error.code, wire::ErrorCode::NotFound);
    handle.shutdown().await;
}

#[tokio::test]
async fn only_a_chat_can_become_a_project() {
    let handle = spawn();
    let task = handle
        .create_task(
            "demo",
            "p",
            "claude",
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
    let lookalike = scratch::root().join(&task);
    std::fs::create_dir_all(&lookalike).unwrap();
    std::fs::write(lookalike.join("keep.txt"), "mine").unwrap();
    let target = std::env::temp_dir().join(format!(
        "wf-not-a-project-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    ));
    for id in [task.as_str(), "t_nope", "../x", "/etc"] {
        let error = call(
            &handle,
            json!({ "method": "chat.createProject", "params": { "task_id": id, "path": target } }),
        )
        .await
        .expect_err("refused");
        assert_eq!(error.code, wire::ErrorCode::NotFound, "{id}");
    }
    assert!(!target.exists());
    assert!(handle.projects().await.is_empty());
    let _ = std::fs::remove_dir_all(&lookalike);
    handle.shutdown().await;
}

#[tokio::test]
async fn a_chat_becomes_a_project_holding_a_copy_of_its_files() {
    let _home = crate::registry::test_home_lock().await;
    let base = tempfile::tempdir().unwrap();
    std::env::set_var("WARPFORGE_HOME", base.path().join("home"));
    std::fs::create_dir_all(base.path().join("home")).unwrap();
    let handle = spawn();
    let chat = create_chat(&handle, false).await;
    let dir = scratch::chat_dir(&chat).unwrap();
    std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
    std::fs::write(dir.join("node_modules/dep/index.js"), "x").unwrap();
    std::fs::write(dir.join("notes.md"), "mine").unwrap();

    let busy = base.path().join("busy");
    std::fs::create_dir_all(&busy).unwrap();
    std::fs::write(busy.join("theirs.txt"), "keep").unwrap();
    let error = call(
        &handle,
        json!({ "method": "chat.createProject", "params": { "task_id": chat, "path": busy, "init_git": false } }),
    )
    .await
    .expect_err("a folder with files is refused");
    assert_eq!(error.code, wire::ErrorCode::InvalidRequest);
    assert!(error.message.contains("not empty"), "{}", error.message);
    assert_eq!(std::fs::read_dir(&busy).unwrap().count(), 1);

    let target = base.path().join("notes-app");
    let created = call(
        &handle,
        json!({ "method": "chat.createProject", "params": { "task_id": chat, "path": target, "init_git": false } }),
    )
    .await
    .expect("project created");
    assert_eq!(created["name"], "notes-app");
    assert_eq!(
        std::fs::read_to_string(target.join("notes.md")).unwrap(),
        "mine"
    );
    assert!(!target.join("node_modules").exists());
    assert!(dir.join("notes.md").exists(), "the chat keeps its folder");
    let projects = handle.projects().await;
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "notes-app");

    let again = call(
        &handle,
        json!({ "method": "chat.createProject", "params": { "task_id": chat, "path": target } }),
    )
    .await
    .expect_err("the name is taken");
    assert_eq!(again.code, wire::ErrorCode::InvalidRequest);
    let _ = std::fs::remove_dir_all(&dir);
    handle.shutdown().await;
}

#[tokio::test]
async fn deleting_a_chat_whose_folder_became_a_link_removes_only_the_link() {
    let handle = spawn();
    let chat = create_chat(&handle, false).await;
    let dir = scratch::chat_dir(&chat).unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("keep.txt"), "not the chat's").unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    std::os::unix::fs::symlink(outside.path(), &dir).unwrap();

    let error = call(
        &handle,
        json!({ "method": "chat.createProject", "params": { "task_id": chat, "path": outside.path().join("copy"), "init_git": false } }),
    )
    .await
    .expect_err("a linked folder is not copied");
    assert!(error.message.contains("link"), "{}", error.message);
    assert!(!outside.path().join("copy").exists());

    call(
        &handle,
        json!({ "method": "task.delete", "params": { "task_id": chat, "delete_folder": true } }),
    )
    .await
    .expect("deleted");
    assert!(std::fs::symlink_metadata(&dir).is_err(), "the link is gone");
    assert_eq!(
        std::fs::read_to_string(outside.path().join("keep.txt")).unwrap(),
        "not the chat's"
    );
    handle.shutdown().await;
}
