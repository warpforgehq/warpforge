use warpforge_protocol as wire;

use crate::daemon::store::Store;
use crate::daemon::task::Task;

#[test]
fn a_chat_stays_a_chat_across_a_reload() {
    let store = Store::open_at(std::path::Path::new(":memory:")).unwrap();
    let plain = Task::new("demo", "p", "claude", vec![]);
    let mut chat = Task::new("", "p", "claude", vec![]);
    chat.kind = wire::TaskKind::Chat;
    store.upsert_task(&plain).unwrap();
    store.upsert_task(&chat).unwrap();

    let loaded = store.load_tasks().unwrap();
    let kind_of = |id: &str| loaded.iter().find(|t| t.id == id).unwrap().kind;
    assert_eq!(kind_of(&plain.id), wire::TaskKind::Task);
    assert_eq!(kind_of(&chat.id), wire::TaskKind::Chat);
}
