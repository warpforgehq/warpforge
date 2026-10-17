//! Board items assigned to a Smith (ADR 0027 invariants 12 and 13).

use std::time::Duration;

use super::*;

fn item(source: &str, project: &str) -> wire::BacklogItem {
    wire::BacklogItem {
        id: format!("b_{source}"),
        number: 1,
        project: project.into(),
        title: "flaky".into(),
        body: String::new(),
        status: "todo".into(),
        priority: "none".into(),
        source: source.into(),
        external_id: None,
        url: None,
        remote_status: None,
        assignee: None,
        created_at: 1,
        updated_at: 1,
        task_id: None,
    }
}

async fn assign(
    daemon: &DaemonHandle,
    item_id: &str,
    project: &str,
    assignee: &str,
) -> Result<wire::BacklogItem, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::BacklogUpdate {
            patch: crate::daemon::backlog::ItemPatch {
                item_id: item_id.into(),
                project: project.into(),
                title: None,
                body: None,
                status: None,
                priority: None,
                assignee: Some(assignee.into()),
            },
            reply: tx,
        })
        .await;
    rx.await.unwrap()
}

#[tokio::test]
async fn a_smith_takes_local_items_only_and_assignment_starts_nothing() {
    let home = home();
    let store = Store::open_at(&home.db).unwrap();
    for item in [
        item("local", "demo"),
        item("github", "demo"),
        item("local", "third"),
    ] {
        let mut item = item;
        item.id = format!("{}_{}", item.id, item.project);
        store.upsert_backlog_item(&item).unwrap();
    }
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let assignee = format!("smith:{}", ada.id);
    let before = daemon.tasks().await.len();

    let assigned = assign(&daemon, "b_local_demo", "demo", &assignee)
        .await
        .unwrap();
    assert_eq!(assigned.assignee.as_deref(), Some(assignee.as_str()));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        daemon.tasks().await.len(),
        before,
        "assigning starts nothing"
    );

    let tracker = assign(&daemon, "b_github_demo", "demo", &assignee)
        .await
        .unwrap_err();
    assert!(tracker.contains("only local items"), "{tracker}");
    let far = assign(&daemon, "b_local_third", "third", &assignee)
        .await
        .unwrap_err();
    assert!(far.contains("may not work in third"), "{far}");
    let ghost = assign(&daemon, "b_local_demo", "demo", "smith:sm_ghost")
        .await
        .unwrap_err();
    assert!(ghost.contains("no Smith has the id"), "{ghost}");
    assert!(
        assign(&daemon, "b_local_demo", "demo", "octocat")
            .await
            .is_ok(),
        "a person still"
    );
}
