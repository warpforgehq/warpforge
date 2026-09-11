use std::path::Path;

use super::*;

fn open() -> MemoryStore {
    MemoryStore::open_at(Path::new(":memory:")).unwrap()
}

#[test]
fn roundtrip_store_search_list_update_delete_stats() {
    let store = open();
    let m = store
        .store(
            "the api listens on port 8080",
            None,
            Some("fact"),
            Some(&["infra".to_string()]),
            None,
            None,
        )
        .unwrap();
    assert_eq!(m.scope, "global");
    assert_eq!(m.kind, "fact");
    assert_eq!(m.tags, vec!["infra".to_string()]);

    let hits = store.search("api", None, None, None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, m.id);

    let listed = store.list(None, Some("fact"), None, None).unwrap();
    assert_eq!(listed.len(), 1);

    let updated = store.update(&m.id, "the api listens on port 9090").unwrap();
    assert_eq!(updated.content, "the api listens on port 9090");
    assert!(store.search("8080", None, None, None).unwrap().is_empty());
    assert_eq!(store.search("9090", None, None, None).unwrap().len(), 1);

    let stats = store.stats().unwrap();
    assert_eq!(stats.global_count, 1);
    assert_eq!(stats.project_count, 0);
    assert_eq!(stats.embedding_mode, "fts");

    store.delete(&m.id).unwrap();
    assert_eq!(store.stats().unwrap().global_count, 0);
}

#[test]
fn global_only_matrix() {
    let mut store = open();
    store.config.project = false;

    let err = store
        .store("x", None, None, None, Some("proj"), None)
        .unwrap_err();
    assert!(err.message().contains("memory.project"));

    store
        .store("global fact", None, None, None, None, None)
        .unwrap();
    let hits = store.search("fact", Some("all"), None, None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].scope, "global");
}

#[test]
fn project_only_matrix() {
    let mut store = open();
    store.config.global = false;

    assert!(store.store("x", None, None, None, None, None).is_err());

    let m = store
        .store("project fact", None, None, None, Some("proj"), None)
        .unwrap();
    assert_eq!(m.scope, "project:proj");

    let stats = store.stats().unwrap();
    assert_eq!(stats.project_count, 1);
    assert_eq!(stats.global_count, 0);
    assert!(!stats.scopes_enabled.global);
    assert!(stats.scopes_enabled.project);
}

#[test]
fn session_scope_is_rejected() {
    let store = open();
    let err = store
        .store("x", Some("session:abc"), None, None, None, None)
        .unwrap_err();
    assert!(err.message().contains("session"));
}
