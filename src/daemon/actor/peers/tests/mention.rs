//! The user on the team and @mentions (ADR 0026 addendum, invariants 16–19),
//! on a real mock session.

use std::path::PathBuf;

use super::*;

const PEER_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-peer.mjs"
);

fn prompt_texts(log: &Path) -> Vec<String> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|line| line["text"].as_str().map(str::to_string))
        .collect()
}

async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    timeout(Duration::from_secs(10), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for: {what}"));
}

async fn wait_idle(daemon: &DaemonHandle, task_id: &str) {
    timeout(Duration::from_secs(10), async {
        loop {
            let idle = daemon.tasks().await.iter().any(|t| {
                t.id == task_id && t.status == TaskStatus::Waiting && t.queued_prompts.is_empty()
            });
            if idle {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the task goes idle");
}

/// A live receiver in `demo`, idle after its opening prompt.
async fn receiver(daemon: &DaemonHandle, dir: &tempfile::TempDir) -> (String, PathBuf) {
    let log = dir.path().join("prompts.log");
    let command = format!("node {PEER_FIXTURE} {}", log.display());
    let id = daemon
        .create_task(
            "demo",
            "receiver work",
            &command,
            vec![],
            false,
            false,
            None,
            vec![],
            None,
            Default::default(),
            None,
        )
        .await;
    eventually("the first prompt", || !prompt_texts(&log).is_empty()).await;
    wait_idle(daemon, &id).await;
    (id, log)
}

async fn user_post(daemon: &DaemonHandle, text: &str) -> Result<wire::PeerSendResult, String> {
    ask(daemon, |reply| PeerCommand::UserPost {
        project: "demo".into(),
        text: text.into(),
        channel_id: None,
        reply,
    })
    .await
}

#[tokio::test]
async fn a_users_mention_is_a_user_turn_and_skips_that_sessions_digest() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(memory_store());
    let (id, log) = receiver(&daemon, &dir).await;

    let sent = user_post(&daemon, &format!("@{id} please take the login bug"))
        .await
        .unwrap();
    let post = sent.message.unwrap();
    assert_eq!(post.status, wire::PeerMessageStatus::Posted);
    assert_eq!(post.mentions, vec![id.clone()]);
    eventually("the mention's turn", || prompt_texts(&log).len() == 2).await;
    let turn = &prompt_texts(&log)[1];
    assert!(turn.contains("please take the login bug"), "{turn}");
    assert!(
        !turn.contains("<peer_message"),
        "a user's word, not a peer's"
    );

    wait_idle(&daemon, &id).await;
    daemon.session_prompt(&id, "next", vec![]).await.unwrap();
    eventually("the next prompt", || prompt_texts(&log).len() == 3).await;
    assert!(!prompt_texts(&log)[2].contains("login bug"), "not repeated");
}

#[tokio::test]
async fn a_post_without_mentions_wakes_nobody() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(memory_store());
    let (_, log) = receiver(&daemon, &dir).await;
    let post = user_post(&daemon, "mail me@example.com about @nobody")
        .await
        .unwrap()
        .message
        .unwrap();
    assert!(post.mentions.is_empty());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(prompt_texts(&log).len(), 1);
}

#[tokio::test]
async fn an_ambiguous_mention_posts_nothing() {
    let store = memory_store();
    for id in ["t_dup1aaaa", "t_dup2bbbb"] {
        let mut twin = task(id, "demo");
        twin.title = "Docs".into();
        store.upsert_task(&twin).unwrap();
    }
    let daemon = seeded(store);
    let error = user_post(&daemon, "@docs update the guide")
        .await
        .unwrap_err();
    assert!(
        error.contains("t_dup1aaaa") && error.contains("t_dup2bbbb"),
        "{error}"
    );
    assert!(feed(&daemon).await.is_empty());
    let error = send(&daemon, "t_a", "team", "@Docs hi").await.unwrap_err();
    assert!(error.contains("more than one session"), "{error}");
}

#[tokio::test]
async fn an_agents_mention_is_a_peer_message_linked_to_the_post() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(memory_store());
    let (id, log) = receiver(&daemon, &dir).await;

    let sent = send(&daemon, "t_a", "team", &format!("@{id} can you look?"))
        .await
        .unwrap();
    let post = sent.message.unwrap();
    assert_eq!(post.mentions, vec![id.clone()]);
    eventually("the peer turn", || prompt_texts(&log).len() == 2).await;
    assert!(
        prompt_texts(&log)[1].contains("kind=\"direct\""),
        "framed as a peer's"
    );
    let direct = feed(&daemon)
        .await
        .into_iter()
        .find(|r| r.to_task.as_deref() == Some(id.as_str()))
        .expect("the direct message's record");
    assert_eq!(direct.source_id, Some(post.id));
    assert_eq!(direct.from_task.as_deref(), Some("t_a"));
}

#[tokio::test]
async fn an_agents_mention_of_an_idle_peer_is_held_and_still_reached() {
    let daemon = seeded(memory_store());
    let sent = send(&daemon, "t_a", "team", "@Work of t_b, see the post")
        .await
        .unwrap();
    let post = sent.message.unwrap();
    assert_eq!(post.mentions, vec!["t_b".to_string()]);
    assert!(sent.notice.unwrap_or_default().contains("not running"));
    let direct = feed(&daemon)
        .await
        .into_iter()
        .find(|r| r.to_task.as_deref() == Some("t_b"))
        .expect("the direct message's record");
    assert_eq!(direct.status, wire::PeerMessageStatus::Held);
    assert_eq!(direct.source_id, Some(post.id));
}

#[tokio::test]
async fn a_users_message_is_a_prompt_with_a_delivered_record() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(memory_store());
    let (id, log) = receiver(&daemon, &dir).await;
    let record = ask(&daemon, |reply| PeerCommand::UserMessage {
        task_id: id.clone(),
        text: "ship it".into(),
        reply,
    })
    .await
    .unwrap()
    .message
    .unwrap();
    assert_eq!(record.from_task, None);
    assert_eq!(record.to_task.as_deref(), Some(id.as_str()));
    assert_eq!(record.status, wire::PeerMessageStatus::Delivered);
    eventually("the user's turn", || prompt_texts(&log).len() == 2).await;
    assert!(!prompt_texts(&log)[1].contains("<peer_message"));
}

#[tokio::test]
async fn a_started_line_links_the_post_and_never_rides_a_digest() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(memory_store());
    let (id, log) = receiver(&daemon, &dir).await;
    let line = ask(&daemon, |reply| PeerCommand::UserStarted {
        task_id: "t_b".into(),
        source_id: Some(41),
        reply,
    })
    .await
    .unwrap();
    assert_eq!(line.started_task.as_deref(), Some("t_b"));
    assert_eq!(line.source_id, Some(41));
    assert_eq!(line.status, wire::PeerMessageStatus::Posted);

    daemon.session_prompt(&id, "next", vec![]).await.unwrap();
    eventually("the next prompt", || prompt_texts(&log).len() == 2).await;
    assert!(
        !prompt_texts(&log)[1].contains("<peer_message"),
        "no digest"
    );
}
