//! Channel conversations (ADR 0026 addendum, invariants 22–25): who a post
//! wakes, where the reply lands, the cap, and coalescing.

use std::time::Duration;

use super::channels::{channel, feed, join, peers, post, send};
use super::sessions::{prompt_texts, wait};
use super::*;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-channel.mjs"
);

struct Member {
    smith: wire::Smith,
    log: PathBuf,
}

impl Member {
    fn prompts(&self) -> Vec<String> {
        prompt_texts(&self.log)
    }
}

async fn member(daemon: &DaemonHandle, home: &Home, name: &str, gate: Option<&Path>) -> Member {
    let log = home._dir.path().join(format!("{name}.log"));
    let gate = gate
        .map(|g| format!(" {}", g.display()))
        .unwrap_or_default();
    let mut create = ada();
    create.name = name.into();
    create.allowed_projects = Vec::new();
    create.agent = format!("node {FIXTURE} {} {name}{gate}", log.display());
    let smith = super::create(daemon, create).await.unwrap().smith;
    Member { smith, log }
}

async fn staffed(daemon: &DaemonHandle, members: &[&Member]) -> wire::Channel {
    let design = channel(daemon, "demo", "design").await.unwrap();
    for member in members {
        join(daemon, &design.id, &member.smith.id).await.unwrap();
    }
    design
}

async fn quiet() {
    tokio::time::sleep(Duration::from_millis(400)).await;
}

fn from(records: &[wire::PeerMessage], member: &Member) -> Vec<String> {
    records
        .iter()
        .filter(|r| r.from_task.as_deref() == Some(member.smith.thread_task_id.as_str()))
        .map(|r| r.text.clone())
        .collect()
}

#[tokio::test]
async fn a_user_post_wakes_every_member_and_their_replies_land_in_the_channel() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let ada = member(&daemon, &home, "Ada", None).await;
    let bo = member(&daemon, &home, "Bo", None).await;
    let design = staffed(&daemon, &[&ada, &bo]).await;

    post(&daemon, "demo", Some(&design.id), "hello team, @Ada first").await;
    wait("each member's turn and the other's reply", || {
        ada.prompts().len() == 2 && bo.prompts().len() == 2
    })
    .await;
    quiet().await;
    assert_eq!(
        ada.prompts().len(),
        2,
        "one turn, not a turn plus a mention"
    );
    assert_eq!(bo.prompts().len(), 2);
    let first = &ada.prompts()[0];
    for part in [
        "<channel_turn channel=\"design\" project=\"demo\">",
        "In #design with you: Bo and the user.",
        "hello team",
        "new=\"true\"",
        "NOTHING_TO_ADD",
    ] {
        assert!(first.contains(part), "{part}: {first}");
    }
    let records = feed(&daemon, Some(&design.id)).await;
    assert_eq!(records.len(), 3, "{records:?}");
    let ada_said = from(&records, &ada);
    let bo_said = from(&records, &bo);
    assert!(ada_said[0].starts_with("Ada reply 1"), "{ada_said:?}");
    assert!(bo_said[0].starts_with("Bo reply 1"), "{bo_said:?}");
    assert!(
        ada.prompts()[1].contains("Bo reply 1"),
        "a Smith's reply wakes the other member"
    );
    assert!(bo.prompts()[1].contains("Ada reply 1"));

    post(&daemon, "demo", Some(&design.id), "please stay quiet").await;
    wait("the quiet turns", || {
        ada.prompts().len() == 3 && bo.prompts().len() == 3
    })
    .await;
    quiet().await;
    assert_eq!(
        feed(&daemon, Some(&design.id)).await.len(),
        4,
        "NOTHING_TO_ADD posts nothing"
    );
}

#[tokio::test]
async fn general_still_wakes_only_whom_a_post_mentions() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let ada = member(&daemon, &home, "Ada", None).await;

    post(&daemon, "demo", None, "general news").await;
    quiet().await;
    assert!(ada.prompts().is_empty());

    post(&daemon, "demo", None, "@Ada have a look").await;
    wait("the mention", || !ada.prompts().is_empty()).await;
    quiet().await;
    let prompt = &ada.prompts()[0];
    assert!(prompt.contains("@Ada have a look"), "{prompt}");
    assert!(!prompt.contains("<channel_turn"), "{prompt}");
    assert_eq!(
        feed(&daemon, Some("general")).await.len(),
        2,
        "no reply posted"
    );
}

#[tokio::test]
async fn agent_wakes_stop_at_the_cap_with_one_alert_until_the_user_posts() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let mut members = Vec::new();
    for name in ["Ada", "Bo", "Cy", "Di", "Ed"] {
        members.push(member(&daemon, &home, name, None).await);
    }
    let design = staffed(&daemon, &members.iter().collect::<Vec<_>>()).await;
    let (ada, others) = members.split_first().unwrap();
    assert_eq!(others.len(), crate::daemon::actor::peers::CHANNEL_WAKES);

    send(&daemon, &ada.smith.thread_task_id, "#design", "status?")
        .await
        .unwrap();
    wait("every other member's turn", || {
        others.iter().all(|m| m.prompts().len() == 1)
    })
    .await;
    quiet().await;

    let tripped = send(
        &daemon,
        &others[0].smith.thread_task_id,
        "#design",
        "me too",
    )
    .await
    .unwrap()
    .message
    .unwrap();
    assert!(tripped.alert, "{tripped:?}");
    assert!(
        tripped
            .reason
            .as_deref()
            .unwrap()
            .contains("woke each other"),
        "{tripped:?}"
    );
    quiet().await;
    assert!(ada.prompts().is_empty(), "over the cap nobody is woken");
    let alerts = peers(&daemon, |reply| PeerCommand::Alerts { reply })
        .await
        .unwrap();
    assert!(alerts.iter().any(|a| a.id == tripped.id), "{alerts:?}");

    post(&daemon, "demo", Some(&design.id), "stay quiet, all of you").await;
    let alerts = peers(&daemon, |reply| PeerCommand::Alerts { reply })
        .await
        .unwrap();
    assert!(alerts.is_empty(), "a user post ends the alert: {alerts:?}");
    wait("the user's turn for every member", || {
        ada.prompts().len() == 1 && others.iter().all(|m| m.prompts().len() == 2)
    })
    .await;
    quiet().await;
    send(&daemon, &others[1].smith.thread_task_id, "#design", "next")
        .await
        .unwrap();
    wait("the cap starts over", || ada.prompts().len() == 2).await;
}

#[tokio::test]
async fn posts_for_a_busy_smith_wait_and_arrive_as_one_turn() {
    let home = home();
    let gate = home._dir.path().join("gate");
    std::fs::write(&gate, "").unwrap();
    let daemon = spawn(&home, &[]);
    let ada = member(&daemon, &home, "Ada", Some(&gate)).await;
    let design = staffed(&daemon, &[&ada]).await;

    post(&daemon, "demo", Some(&design.id), "first ask").await;
    wait("the first turn", || ada.prompts().len() == 1).await;
    post(&daemon, "demo", Some(&design.id), "second ask").await;
    post(&daemon, "demo", Some(&design.id), "third ask").await;
    quiet().await;
    assert_eq!(
        ada.prompts().len(),
        1,
        "nothing queued behind the running turn"
    );

    std::fs::remove_file(&gate).unwrap();
    wait("the coalesced turn", || ada.prompts().len() == 2).await;
    quiet().await;
    assert_eq!(ada.prompts().len(), 2, "her own replies do not wake her");
    let next = &ada.prompts()[1];
    assert!(
        next.contains("second ask") && next.contains("third ask"),
        "{next}"
    );
    assert_eq!(next.matches("new=\"true\"").count(), 2, "{next}");
    assert_eq!(from(&feed(&daemon, Some(&design.id)).await, &ada).len(), 2);
}
