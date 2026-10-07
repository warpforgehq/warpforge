use super::*;
use crate::daemon::html_render::{publish, store};

async fn task(daemon: &DaemonHandle) -> String {
    daemon
        .create_task(
            "demo",
            "draw a chart",
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
        .await
}

#[tokio::test]
async fn a_published_page_is_in_the_history_and_goes_with_its_task() {
    let store_db = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store_db);
    let id = task(&daemon).await;

    let result = publish(
        &daemon,
        id.clone(),
        "<p>chart</p>".into(),
        " Revenue ".into(),
        5000.0,
    )
    .await
    .expect("published");
    assert_eq!(result["title"], "Revenue");
    assert_eq!(result["height"], 2000);
    let render_id = result["render_id"].as_str().unwrap().to_string();

    let page = store::task_dir(&id)
        .unwrap()
        .join(format!("{render_id}.html"));
    let html = std::fs::read_to_string(&page).expect("page stored");
    assert!(html.contains("wf-render-theme") && html.ends_with("<p>chart</p>"));

    let history = daemon.session_history(id.clone()).await.unwrap();
    assert!(
        history.contains(&warpforge_protocol::SessionUpdate::HtmlRender {
            render_id,
            title: "Revenue".into(),
            height: 2000,
        })
    );

    daemon.delete_task(&id).await.unwrap();
    let dir = store::task_dir(&id).unwrap();
    timeout(Duration::from_secs(5), async {
        while dir.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the task's pages are removed with it");
}

#[tokio::test]
async fn a_page_for_an_unknown_task_is_refused_and_not_kept() {
    let daemon = Daemon::spawn(test_projects(), None);
    let error = publish(
        &daemon,
        "t_missing".into(),
        "<p>x</p>".into(),
        "X".into(),
        300.0,
    )
    .await
    .unwrap_err();
    assert!(error.contains("no task"), "{error}");
    let dir = store::task_dir("t_missing").unwrap();
    let left = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
    assert_eq!(left, 0);

    let error = publish(
        &daemon,
        "t_missing".into(),
        "<p>x</p>".into(),
        " ".into(),
        300.0,
    )
    .await
    .unwrap_err();
    assert!(error.contains("title"), "{error}");
}
