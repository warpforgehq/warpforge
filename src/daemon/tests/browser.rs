use super::*;
use crate::daemon::browser::{self, Grants};
use crate::daemon::server::{ClientHub, HubConnection};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message;
use warpforge_protocol as wire;

/// A daemon with one task whose mock agent session is live.
async fn live_task() -> (DaemonHandle, broadcast::Receiver<Event>, String) {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let mut events = daemon.subscribe();
    let mock = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/mock-acp-agent-noedit.mjs"
    );
    let task_id = daemon
        .create_task(
            "demo",
            "look at the page",
            &format!("node {mock}"),
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    loop {
        match timeout(Duration::from_secs(5), events.recv()).await {
            Ok(Ok(Event::SessionUpdate {
                task_id: tid,
                update: wire::SessionUpdate::TurnEnded { .. },
            })) if tid == task_id => break,
            Ok(Ok(_)) => {}
            _ => panic!("the mock session never finished its turn"),
        }
    }
    (daemon, events, task_id)
}

/// Register `conn` as the browser; returns its event queue and the receiver
/// the daemon's requests arrive on.
fn register(conn: &HubConnection<'_>) -> (mpsc::Sender<Message>, mpsc::Receiver<Message>) {
    let (tx, rx) = mpsc::channel(8);
    let mut method = wire::Method::ClientRegister {
        capabilities: vec![wire::BROWSER_CAPABILITY.into()],
    };
    conn.intercept(1, &mut method, &tx);
    (tx, rx)
}

fn client_request(message: Message) -> (String, wire::ClientRequestBody) {
    let Message::Text(text) = message else {
        panic!("not text")
    };
    match serde_json::from_str(&text).unwrap() {
        wire::ServerMessage::Event(wire::Event::ClientRequest {
            request_id, body, ..
        }) => (request_id, body),
        other => panic!("not a client request: {other:?}"),
    }
}

fn answer(conn: &HubConnection<'_>, tx: &mpsc::Sender<Message>, request_id: String, result: Value) {
    let mut method = wire::Method::ClientReply {
        request_id,
        result: Some(result),
        error: None,
    };
    conn.intercept(2, &mut method, tx);
}

/// The next approval prompt on the task: its id and the site it names.
async fn prompt_for(events: &mut broadcast::Receiver<Event>, task_id: &str) -> (String, String) {
    loop {
        match timeout(Duration::from_secs(5), events.recv()).await {
            Ok(Ok(Event::SessionUpdate {
                task_id: tid,
                update:
                    wire::SessionUpdate::PermissionRequest {
                        request_id,
                        browser_origin,
                        ..
                    },
            })) if tid == task_id => return (request_id, browser_origin.unwrap_or_default()),
            Ok(Ok(_)) => {}
            _ => panic!("no approval prompt on the task"),
        }
    }
}

async fn prompt(events: &mut broadcast::Receiver<Event>, task_id: &str) -> String {
    prompt_for(events, task_id).await.0
}

/// An origin outside the project's services raises a prompt on the task's
/// chat; "always" lets the action run and keeps the origin for the task.
#[tokio::test]
async fn a_foreign_origin_is_asked_about_on_the_task_and_always_is_remembered() {
    let (daemon, mut events, task_id) = live_task().await;
    let (hub, grants) = (ClientHub::default(), Grants::default());
    let desktop = hub.connection();
    let (tx, mut requests) = register(&desktop);

    let act = browser::act(
        &daemon,
        &hub,
        &grants,
        "demo",
        &task_id,
        wire::BrowserAction::Snapshot,
    );
    let desktop_and_user = async {
        let (first, _) = client_request(requests.recv().await.unwrap());
        answer(
            &desktop,
            &tx,
            first,
            json!({ "blocked": "https://example.com" }),
        );
        let request_id = prompt(&mut events, &task_id).await;
        daemon
            .session_permission(&task_id, &request_id, "allow_always")
            .await
            .expect("the answer wins");
        let (second, body) = client_request(requests.recv().await.unwrap());
        let wire::ClientRequestBody::Browser {
            allowed_origins, ..
        } = body
        else {
            panic!("a browser request");
        };
        assert!(allowed_origins.contains(&"https://example.com".to_string()));
        let page = json!({ "origin": "https://example.com", "url": "https://example.com/", "tree": "- link \"x\" [e1]" });
        answer(&desktop, &tx, second, page);
    };
    let (result, ()) = tokio::join!(act, desktop_and_user);
    assert_eq!(result.unwrap()["tree"], "- link \"x\" [e1]");
    assert_eq!(grants.of(&task_id), vec!["https://example.com".to_string()]);
}

/// The live bypass: the desktop let a snapshot through because the native URL
/// already showed an allowed address, while the document was another site.
/// The daemon still refuses a result that names an unapproved document.
#[tokio::test]
async fn a_result_from_an_unapproved_document_is_asked_about_and_never_returned_when_denied() {
    let (daemon, mut events, task_id) = live_task().await;
    let (hub, grants) = (ClientHub::default(), Grants::default());
    let desktop = hub.connection();
    let (tx, mut requests) = register(&desktop);

    let act = browser::act(
        &daemon,
        &hub,
        &grants,
        "demo",
        &task_id,
        wire::BrowserAction::Snapshot,
    );
    let desktop_and_user = async {
        let (first, _) = client_request(requests.recv().await.unwrap());
        let leaked = json!({ "origin": "https://www.google.com", "url": "https://www.google.com/", "tree": "secret" });
        answer(&desktop, &tx, first, leaked);
        let request_id = prompt(&mut events, &task_id).await;
        daemon
            .session_permission(&task_id, &request_id, "deny")
            .await
            .expect("the answer wins");
    };
    let (result, ()) = tokio::join!(act, desktop_and_user);
    let error = result.unwrap_err();
    assert!(error.contains("declined"), "{error}");
    assert!(!error.contains("secret"));
    assert!(
        requests.try_recv().is_err(),
        "a denied action is not retried"
    );
}

/// A navigation to a site outside the project asks first, and the desktop
/// hears nothing of it until the user says yes; no answer means no load.
#[tokio::test]
async fn navigating_to_a_foreign_site_asks_before_anything_loads() {
    let (daemon, mut events, task_id) = live_task().await;
    let (hub, grants) = (ClientHub::default(), Grants::default());
    let desktop = hub.connection();
    let (_tx, mut requests) = register(&desktop);

    let navigate = wire::BrowserAction::Navigate {
        url: "https://example.com".into(),
    };
    let act = browser::act(&daemon, &hub, &grants, "demo", &task_id, navigate);
    let user = async {
        let (request_id, site) = prompt_for(&mut events, &task_id).await;
        assert_eq!(site, "https://example.com", "the prompt names the site");
        assert!(
            requests.try_recv().is_err(),
            "nothing loads before the answer"
        );
        daemon
            .session_permission(&task_id, &request_id, "deny")
            .await
            .expect("the answer wins");
    };
    let (result, ()) = tokio::join!(act, user);
    assert!(result.unwrap_err().contains("declined"));
    assert!(requests.try_recv().is_err());
}

#[tokio::test]
async fn a_result_that_does_not_name_its_document_is_refused() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let (hub, grants) = (ClientHub::default(), Grants::default());
    let desktop = hub.connection();
    let (tx, mut requests) = register(&desktop);

    let act = browser::act(
        &daemon,
        &hub,
        &grants,
        "demo",
        "t_1",
        wire::BrowserAction::Console,
    );
    let reply = async {
        let (id, _) = client_request(requests.recv().await.unwrap());
        answer(
            &desktop,
            &tx,
            id,
            json!({ "messages": [{ "level": "log", "text": "hi" }] }),
        );
    };
    let (result, ()) = tokio::join!(act, reply);
    assert!(result.unwrap_err().contains("did not say which page"));
}

#[tokio::test]
async fn without_a_task_a_foreign_origin_is_refused_and_no_desktop_is_an_error() {
    let store = Store::open_at(std::path::Path::new(":memory:")).ok();
    let daemon = Daemon::spawn(test_projects(), store);
    let hub = ClientHub::default();
    let grants = Grants::default();

    let navigate = wire::BrowserAction::Navigate {
        url: "https://example.com".into(),
    };
    let refused = browser::act(&daemon, &hub, &grants, "demo", "", navigate).await;
    assert!(refused.unwrap_err().contains("no Warpforge task"));

    let console = wire::BrowserAction::Console;
    let nobody = browser::act(&daemon, &hub, &grants, "demo", "", console.clone()).await;
    assert!(nobody.unwrap_err().contains("no Warpforge desktop app"));

    let unknown = browser::act(&daemon, &hub, &grants, "nope", "", console).await;
    assert!(unknown.unwrap_err().contains("no project named"));
}
