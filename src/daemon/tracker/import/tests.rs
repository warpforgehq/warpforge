use super::super::super::store::{Store, TrackerLink};
use super::super::{make_link, RemoteIssue};
use super::adopt_imported;

use warpforge_protocol as wire;

#[test]
fn missing_backlog_rows_can_be_recovered_from_tracker_links() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let link = make_link(
        "item-1",
        "github",
        "demo",
        "#1",
        "https://github.com/demo/1",
        true,
    );
    store.upsert_tracker_link(&link).unwrap();
    let issue = RemoteIssue {
        external_id: "#1".into(),
        title: "Recovered issue".into(),
        body: "body".into(),
        url: "https://github.com/demo/1".into(),
        status: "todo".into(),
        remote_status: "OPEN".into(),
        assignee: None,
        created_at: 1,
        updated_at: 1,
    };
    let (imported, _) =
        adopt_imported(&store, "demo", None, vec![("github".into(), vec![issue])]).unwrap();
    assert_eq!(imported.len(), 1);
    assert_eq!(
        store.get_backlog_item("item-1").unwrap().unwrap().title,
        "Recovered issue"
    );
}

#[test]
fn imported_rows_carry_the_issue_creation_time_and_repair_older_rows() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let issue = || RemoteIssue {
        external_id: "#1".into(),
        title: "Opened long ago".into(),
        body: String::new(),
        url: "https://github.com/demo/1".into(),
        status: "todo".into(),
        remote_status: "OPEN".into(),
        assignee: None,
        created_at: 100,
        updated_at: 500,
    };

    let (imported, _) =
        adopt_imported(&store, "demo", None, vec![("github".into(), vec![issue()])]).unwrap();
    let item_id = imported[0].item_id.clone();
    let item = store.get_backlog_item(&item_id).unwrap().unwrap();
    assert_eq!(item.created_at, 100, "created is the issue's own open time");
    assert_eq!(item.updated_at, 500);

    // A row imported before creation times were read stored the fetch time
    // as its creation time. The next sync repairs it, even though the
    // issue's status has not moved.
    store.set_backlog_created_at(&item_id, 500).unwrap();
    let (again, synced) =
        adopt_imported(&store, "demo", None, vec![("github".into(), vec![issue()])]).unwrap();
    assert!(again.is_empty(), "a known issue is not imported twice");
    assert!(
        synced.is_empty(),
        "an unmoved status is not a status change"
    );
    assert_eq!(
        store
            .get_backlog_item(&item_id)
            .unwrap()
            .unwrap()
            .created_at,
        100
    );
}

#[test]
fn a_row_imported_without_an_assignee_picks_one_up_on_the_next_sync() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let issue = |assignee: Option<&str>| RemoteIssue {
        external_id: "ENG-1".into(),
        title: "Assigned since".into(),
        body: String::new(),
        url: "https://linear.app/x/ENG-1".into(),
        status: "todo".into(),
        remote_status: "Todo".into(),
        assignee: assignee.map(str::to_string),
        created_at: 100,
        updated_at: 500,
    };

    // The listing that first adopted this issue did not ask for one.
    let (imported, _) = adopt_imported(
        &store,
        "demo",
        None,
        vec![("linear".into(), vec![issue(None)])],
    )
    .unwrap();
    let item_id = imported[0].item_id.clone();
    assert_eq!(
        store.get_backlog_item(&item_id).unwrap().unwrap().assignee,
        None
    );

    let (again, _) = adopt_imported(
        &store,
        "demo",
        None,
        vec![("linear".into(), vec![issue(Some("Ada Lovelace"))])],
    )
    .unwrap();
    assert!(again.is_empty(), "a known issue is not imported twice");
    assert_eq!(
        store
            .get_backlog_item(&item_id)
            .unwrap()
            .unwrap()
            .assignee
            .as_deref(),
        Some("Ada Lovelace"),
        "the tracker owns who an imported issue is assigned to"
    );
}

#[test]
fn imported_rows_are_recovered_into_yaml_backend_not_sqlite() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let project_path = dir.path().join("checkout");
    let link = make_link(
        "item-1",
        "github",
        "demo",
        "#1",
        "https://github.com/demo/1",
        true,
    );
    store.upsert_tracker_link(&link).unwrap();
    let issue = RemoteIssue {
        external_id: "#1".into(),
        title: "Recovered in YAML".into(),
        body: "body".into(),
        url: "https://github.com/demo/1".into(),
        status: "todo".into(),
        remote_status: "OPEN".into(),
        assignee: None,
        created_at: 1,
        updated_at: 1,
    };
    let (imported, _) = adopt_imported(
        &store,
        "demo",
        Some(project_path.to_str().unwrap()),
        vec![("github".into(), vec![issue])],
    )
    .unwrap();
    assert_eq!(imported.len(), 1);
    // Item is project-locally in YAML, NOT a SQLite shadow row.
    let yaml_items = crate::daemon::backlog::list(project_path.to_str().unwrap(), "demo").unwrap();
    assert_eq!(yaml_items.len(), 1);
    assert_eq!(yaml_items[0].title, "Recovered in YAML");
    assert!(store.get_backlog_item("item-1").unwrap().is_none());
}

#[test]
fn linear_team_mapping_round_trips_and_defaults_to_unmapped() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let unmapped = store.tracker_project_settings("alpha").unwrap();
    assert_eq!(unmapped.linear_team_id, None);

    let mapped = store
        .set_tracker_project_linear_team("alpha", Some("team-1"), Some("Engineering"))
        .unwrap();
    assert_eq!(mapped.linear_team_id.as_deref(), Some("team-1"));
    assert_eq!(mapped.linear_team_name.as_deref(), Some("Engineering"));
    assert_eq!(
        store.tracker_project_settings("alpha").unwrap(),
        mapped,
        "the mapping must survive a reread"
    );
    // Another project is untouched — that is the whole point of the mapping.
    assert_eq!(
        store
            .tracker_project_settings("beta")
            .unwrap()
            .linear_team_id,
        None
    );
}

#[test]
fn unmapping_linear_drops_imported_rows_but_keeps_locally_written_ones() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let item = |id: &str, title: &str| wire::BacklogItem {
        id: id.into(),
        number: 1,
        project: "alpha".into(),
        title: title.into(),
        body: String::new(),
        status: "todo".into(),
        priority: "none".into(),
        source: "linear".into(),
        external_id: Some("ENG-1".into()),
        url: None,
        remote_status: None,
        assignee: None,
        created_at: 0,
        updated_at: 0,
        task_id: None,
    };
    for (id, title, imported) in [("mirror", "From Linear", true), ("mine", "Wrote it", false)] {
        store.upsert_backlog_item(&item(id, title)).unwrap();
        store
            .upsert_tracker_link(&make_link(
                id,
                "linear",
                "alpha",
                "ENG-1",
                "https://linear.app/x",
                imported,
            ))
            .unwrap();
    }

    assert_eq!(store.delete_imported_linear_items("alpha").unwrap(), 1);
    assert!(store.get_backlog_item("mirror").unwrap().is_none());
    assert!(
        store.get_backlog_item("mine").unwrap().is_some(),
        "an item written here and pushed to Linear is local work, not a mirror"
    );
    assert!(store.load_tracker_link("mirror").unwrap().is_none());
    assert!(store.load_tracker_link("mine").unwrap().is_some());
}

#[test]
fn import_dedupe_is_project_scoped() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    // Project "alpha" already imported github issue #1.
    let existing = TrackerLink {
        item_id: "alpha-1".into(),
        provider: "github".into(),
        project: "alpha".into(),
        external_id: "#1".into(),
        url: "https://github.com/a/r/issues/1".into(),
        status: "todo".into(),
        remote_status: Some("OPEN".into()),
        last_synced_at: 0,
        task_id: None,
        imported: true,
    };
    store.upsert_tracker_link(&existing).unwrap();
    store
        .upsert_backlog_item(&wire::BacklogItem {
            id: "alpha-1".into(),
            number: 1,
            project: "alpha".into(),
            title: "alpha issue".into(),
            body: String::new(),
            status: "todo".into(),
            priority: "none".into(),
            source: "github".into(),
            external_id: Some("#1".into()),
            url: Some("https://github.com/a/r/issues/1".into()),
            remote_status: Some("OPEN".into()),
            assignee: None,
            created_at: 1,
            updated_at: 1,
            task_id: None,
        })
        .unwrap();

    // Same provider + external_id imported into a *different* project must
    // NOT be treated as known: it is a different repo's issue #1.
    let issue = RemoteIssue {
        external_id: "#1".into(),
        title: "beta issue".into(),
        body: String::new(),
        url: "https://github.com/b/r/issues/1".into(),
        status: "todo".into(),
        remote_status: "OPEN".into(),
        assignee: None,
        created_at: 1,
        updated_at: 1,
    };
    let (imported, _) =
        adopt_imported(&store, "beta", None, vec![("github".into(), vec![issue])]).unwrap();
    assert_eq!(
        imported.len(),
        1,
        "cross-project external id must not dedupe"
    );
    assert_eq!(imported[0].project, "beta");
    // And a reimport of the *same* project stays a no-op.
    let again = RemoteIssue {
        external_id: "#1".into(),
        title: "beta again".into(),
        body: String::new(),
        url: "https://github.com/b/r/issues/1".into(),
        status: "todo".into(),
        remote_status: "OPEN".into(),
        assignee: None,
        created_at: 1,
        updated_at: 1,
    };
    let (second, _) =
        adopt_imported(&store, "beta", None, vec![("github".into(), vec![again])]).unwrap();
    assert_eq!(second.len(), 0, "same-project reimport must dedupe");
}
