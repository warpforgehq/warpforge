use super::*;
use crate::daemon::task::Task;

/// A Factory task that ran in the project checkout is followed by its task
/// branch from the project's path, whatever the checkout has out now; any
/// unowned task without a worktree is not followed.
#[test]
fn a_factory_run_in_the_checkout_is_followed_by_its_task_branch() {
    let mut factory = Task::new("demo", "p", "claude", vec!["runner".into()]);
    factory.base_branch = Some("main".into());
    let plain = Task::new("demo", "p", "claude", Vec::new());
    let paths = HashMap::from([("demo".to_string(), "/work/demo".to_string())]);
    let found = super::super::targets(&[factory.clone(), plain], &paths);
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[&factory.id],
        PullTarget {
            worktree: "/work/demo".into(),
            base_branch: Some("main".into()),
            head: Some(format!("warpforge/task/{}", factory.id)),
        }
    );
}
fn folder(branch: Option<&str>) -> Task {
    let mut task = Task::new("demo", "p", "claude", Vec::new());
    task.base_branch = Some("develop".into());
    task.keepers = Some(wire::TaskKeepers {
        branch: branch.map(str::to_owned),
        ..Default::default()
    });
    task
}

fn paths() -> HashMap<String, String> {
    HashMap::from([("demo".into(), "/work/demo".into())])
}

#[test]
fn owned_folder_feature_branch_gets_a_target() {
    let task = folder(Some("feat/owned"));
    let found = super::super::targets(std::slice::from_ref(&task), &paths());
    assert_eq!(
        found[&task.id],
        PullTarget {
            worktree: "/work/demo".into(),
            base_branch: Some("develop".into()),
            head: Some("feat/owned".into()),
        }
    );
}

#[test]
fn base_branches_and_missing_ownership_get_no_target() {
    for branch in [Some("main"), Some("master"), Some("develop"), None] {
        assert!(super::super::targets(&[folder(branch)], &paths()).is_empty());
    }
    let mut task = folder(None);
    task.keepers = None;
    assert!(super::super::targets(&[task], &paths()).is_empty());
}

#[tokio::test]
async fn shared_folder_branch_is_cached_per_task_and_can_be_force_refreshed() {
    let tasks = [folder(Some("feat/shared")), folder(Some("feat/shared"))];
    let targets = super::super::targets(&tasks, &paths());
    assert_eq!(targets.len(), 2);
    let open = pull(wire::TaskPullState::Open, Some(wire::PullChecks::Pending));
    let merged = pull(wire::TaskPullState::Merged, None);
    let (fetch, calls) = scripted(vec![
        Ok(Some(open.clone())),
        Ok(Some(open.clone())),
        Ok(Some(merged.clone())),
    ]);
    let watch = Arc::new(PullWatch::new(fetch, no_comments()));
    let (events, mut rx) = broadcast::channel(16);
    watch.refresh(targets.clone(), None, Duration::from_secs(60), &events);
    next_pull_event(&mut rx).await;
    next_pull_event(&mut rx).await;
    let cached = watch.refresh(targets.clone(), None, Duration::from_secs(60), &events);
    assert_eq!(cached.len(), 2);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    watch.refresh(
        targets.clone(),
        Some(&[tasks[0].id.clone()]),
        Duration::ZERO,
        &events,
    );
    assert_eq!(
        next_pull_event(&mut rx).await,
        (tasks[0].id.clone(), Some(merged.clone()))
    );
    let cached = watch.refresh(targets, None, Duration::from_secs(60), &events);
    assert_eq!(cached[&tasks[0].id], merged);
    assert_eq!(cached[&tasks[1].id], open);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}
