//! The Chats shelf's bulk delete: chats only, and never a folder holding files.

use super::*;
use crate::daemon::scratch;
use crate::daemon::task::{Task, TaskStatus};
use crate::daemon::{Daemon, Store};

fn settled(project: &str, kind: wire::TaskKind) -> Task {
    let mut task = Task::new(project, "p", "claude", Vec::new());
    task.kind = kind;
    task.status = TaskStatus::Done;
    task
}

#[tokio::test]
async fn the_chats_shelf_deletes_chats_only_and_keeps_folders_with_files() {
    let db = tempfile::tempdir().unwrap();
    let store = Store::open_at(&db.path().join("warpforge.db")).unwrap();
    let empty = settled("", wire::TaskKind::Chat);
    let with_files = settled("", wire::TaskKind::Chat);
    let legacy = settled("", wire::TaskKind::Task);
    for task in [&empty, &with_files, &legacy] {
        store.upsert_task(task).unwrap();
    }
    scratch::create(&empty.id).unwrap();
    let folder = scratch::create(&with_files.id).unwrap();
    std::fs::write(folder.join("notes.md"), "mine").unwrap();

    let handle = Daemon::spawn(Vec::new(), Some(store));
    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::External));
    let method: wire::Method = serde_json::from_value(json!({
        "method": "task.deleteSettled",
        "params": { "kind": "chat" }
    }))
    .unwrap();
    let result = dispatch(&handle, method, &lifecycle).await.unwrap();
    assert_eq!(result["deleted"], 1);
    assert_eq!(result["kept"], 1);

    let left: Vec<String> = handle.tasks().await.into_iter().map(|t| t.id).collect();
    assert!(!left.contains(&empty.id));
    assert!(
        left.contains(&with_files.id),
        "a chat whose folder holds files stays"
    );
    assert!(
        left.contains(&legacy.id),
        "a task with an empty project is not a chat"
    );
    assert!(folder.join("notes.md").exists());
    let _ = scratch::remove(&with_files.id, true);
    handle.shutdown().await;
}
