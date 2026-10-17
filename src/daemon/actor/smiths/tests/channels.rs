//! Named channels (ADR 0026 addendum): the user's to create and staff, read
//! by their Smiths beside `#general`, under the one cursor per task.

use super::sessions::{ada_on, agent, prompt_texts, wait, wait_idle};
use super::*;

async fn peers<T>(
    daemon: &DaemonHandle,
    build: impl FnOnce(tokio::sync::oneshot::Sender<Result<T, String>>) -> PeerCommand,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon.send(Command::Peers(build(tx))).await;
    rx.await.unwrap()
}

async fn channel(
    daemon: &DaemonHandle,
    project: &str,
    name: &str,
) -> Result<wire::Channel, String> {
    peers(daemon, |reply| PeerCommand::ChannelsCreate {
        project: project.into(),
        name: name.into(),
        reply,
    })
    .await
}

async fn join(daemon: &DaemonHandle, id: &str, smith_id: &str) -> Result<wire::Channel, String> {
    peers(daemon, |reply| PeerCommand::ChannelsSetMember {
        id: id.into(),
        smith_id: smith_id.into(),
        member: true,
        reply,
    })
    .await
}

async fn send(
    daemon: &DaemonHandle,
    from: &str,
    to: &str,
    text: &str,
) -> Result<wire::PeerSendResult, String> {
    peers(daemon, |reply| PeerCommand::Message {
        from_task_id: from.into(),
        to: to.into(),
        message: text.into(),
        reply,
    })
    .await
}

async fn post(daemon: &DaemonHandle, project: &str, channel: Option<&str>, text: &str) {
    peers(daemon, |reply| PeerCommand::UserPost {
        project: project.into(),
        text: text.into(),
        channel_id: channel.map(str::to_string),
        reply,
    })
    .await
    .unwrap();
}

async fn feed(daemon: &DaemonHandle, channel: Option<&str>) -> Vec<wire::PeerMessage> {
    peers(daemon, |reply| PeerCommand::Feed {
        project: None,
        before: None,
        limit: None,
        channel: channel.map(str::to_string),
        reply,
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn channels_are_named_words_staffed_with_allowed_smiths_only() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada()).await.unwrap().smith;
    for (project, name, error) in [
        ("demo", "General", "every project's own channel"),
        ("demo", "two words", "one word"),
        ("nope", "design", "unknown project"),
    ] {
        let refused = channel(&daemon, project, name).await.unwrap_err();
        assert!(refused.contains(error), "{name}: {refused}");
    }
    let design = channel(&daemon, "demo", "#Design").await.unwrap();
    assert_eq!(design.name, "design");
    assert!(channel(&daemon, "demo", "design").await.is_err());
    channel(&daemon, "other", "design").await.unwrap();
    let third = channel(&daemon, "third", "ops").await.unwrap();
    let refused = join(&daemon, &third.id, &ada.id).await.unwrap_err();
    assert!(refused.contains("not allowed in third"), "{refused}");

    let joined = join(&daemon, &design.id, &ada.id).await.unwrap();
    assert_eq!(joined.members[0].name, "Ada");
    let listed = peers(&daemon, |reply| PeerCommand::ChannelsList {
        project: None,
        task_id: Some(ada.thread_task_id.clone()),
        reply,
    })
    .await
    .unwrap();
    assert_eq!(listed.len(), 1, "only the channels the thread is in");
    ask(&daemon, |reply| SmithCommand::Delete {
        id: ada.id.clone(),
        reply,
    })
    .await
    .unwrap();
    let all = peers(&daemon, |reply| PeerCommand::ChannelsList {
        project: Some("demo".into()),
        task_id: None,
        reply,
    })
    .await
    .unwrap();
    assert!(
        all[0].members.is_empty(),
        "a deleted Smith leaves its channels"
    );
}

#[tokio::test]
async fn a_named_channel_takes_posts_from_its_members_only() {
    let home = home();
    let daemon = spawn(&home, &[task("t_a", "demo")]);
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let refused = send(&daemon, "t_a", "#design", "hi").await.unwrap_err();
    assert!(refused.contains("no channel #design"), "{refused}");
    let design = channel(&daemon, "demo", "design").await.unwrap();
    let refused = send(&daemon, "t_a", "#design", "hi").await.unwrap_err();
    assert!(refused.contains("not a member of #design"), "{refused}");
    assert!(
        feed(&daemon, None).await.is_empty(),
        "a refusal records nothing"
    );

    join(&daemon, &design.id, &ada.id).await.unwrap();
    let sent = send(&daemon, &ada.thread_task_id, "#design", "from Ada")
        .await
        .unwrap();
    assert_eq!(
        sent.message.unwrap().channel_id.as_deref(),
        Some(design.id.as_str())
    );
    for to in ["team", "#general"] {
        let sent = send(&daemon, "t_a", to, to).await.unwrap();
        assert_eq!(sent.message.unwrap().channel_id, None, "{to}");
    }
    assert_eq!(feed(&daemon, Some(&design.id)).await.len(), 1);
    assert_eq!(feed(&daemon, Some("general")).await.len(), 2);
    assert_eq!(feed(&daemon, None).await.len(), 3);

    let restarted = spawn(&home, &[]);
    let kept = peers(&restarted, |reply| PeerCommand::ChannelsList {
        project: Some("demo".into()),
        task_id: None,
        reply,
    })
    .await
    .unwrap();
    assert_eq!(kept[0].members[0].smith_id, ada.id);
    assert!(kept[0].last_post_at.is_some(), "its posts reload with it");
}

#[tokio::test]
async fn a_smith_reads_its_channels_and_general_under_one_cursor() {
    let home = home();
    let thread_agent = agent(home._dir.path(), false);
    let plain_dir = tempfile::tempdir().unwrap();
    let plain_agent = agent(plain_dir.path(), false);
    let daemon = spawn(&home, &[task("t_a", "demo")]);
    let ada = create(&daemon, ada_on(&thread_agent)).await.unwrap().smith;
    let plain = daemon
        .create_task(
            "demo",
            "plain work",
            &plain_agent.command,
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
    let plain_log = plain_agent.log.clone();
    wait("the plain session's prompt", || {
        !prompt_texts(&plain_log).is_empty()
    })
    .await;
    wait_idle(&daemon, &plain).await;

    let design = channel(&daemon, "demo", "design").await.unwrap();
    let ops = channel(&daemon, "other", "ops").await.unwrap();
    let secret = channel(&daemon, "demo", "secret").await.unwrap();
    join(&daemon, &design.id, &ada.id).await.unwrap();
    join(&daemon, &ops.id, &ada.id).await.unwrap();
    send(&daemon, "t_a", "team", "general-one").await.unwrap();
    post(&daemon, "demo", Some(&design.id), "design-one").await;
    post(&daemon, "other", Some(&ops.id), "ops-one").await;
    post(&daemon, "demo", Some(&secret.id), "secret-one").await;
    post(&daemon, "other", None, "other-general").await;

    daemon
        .session_prompt(&ada.thread_task_id, "catch up", vec![])
        .await
        .unwrap();
    let log = thread_agent.log.clone();
    wait("the thread's prompt", || !prompt_texts(&log).is_empty()).await;
    let first = &prompt_texts(&thread_agent.log)[0];
    for seen in [
        "general-one",
        "design-one",
        "ops-one",
        "channel=\"design\"",
        "channel=\"ops\"",
    ] {
        assert!(first.contains(seen), "{seen}: {first}");
    }
    for unseen in ["secret-one", "other-general"] {
        assert!(!first.contains(unseen), "{unseen}: {first}");
    }
    wait_idle(&daemon, &ada.thread_task_id).await;

    post(&daemon, "other", Some(&ops.id), "ops-two").await;
    daemon
        .session_prompt(&ada.thread_task_id, "again", vec![])
        .await
        .unwrap();
    wait("the thread's next prompt", || prompt_texts(&log).len() == 2).await;
    let next = &prompt_texts(&thread_agent.log)[1];
    assert!(next.contains("ops-two"), "{next}");
    for seen in ["general-one", "design-one", "ops-one"] {
        assert!(!next.contains(seen), "one cursor across channels: {next}");
    }

    daemon.session_prompt(&plain, "next", vec![]).await.unwrap();
    wait("the plain session's next prompt", || {
        prompt_texts(&plain_log).len() == 2
    })
    .await;
    let plain_next = &prompt_texts(&plain_agent.log)[1];
    assert!(plain_next.contains("general-one"), "{plain_next}");
    for unseen in ["design-one", "ops-one", "secret-one"] {
        assert!(!plain_next.contains(unseen), "#general only: {plain_next}");
    }
}

async fn members_in(daemon: &DaemonHandle, project: &str) -> Vec<wire::ChannelMember> {
    peers(daemon, |reply| PeerCommand::ChannelsList {
        project: Some(project.into()),
        task_id: None,
        reply,
    })
    .await
    .unwrap()
    .remove(0)
    .members
}

async fn allow(daemon: &DaemonHandle, id: &str, projects: &[&str]) {
    ask(daemon, |reply| SmithCommand::Update {
        id: id.into(),
        patch: Box::new(wire::SmithPatch {
            allowed_projects: Some(projects.iter().map(|p| p.to_string()).collect()),
            ..Default::default()
        }),
        reply,
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn a_project_taken_from_a_smith_takes_its_memberships_there() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let ada = create(&daemon, ada()).await.unwrap().smith;
    let design = channel(&daemon, "demo", "design").await.unwrap();
    let ops = channel(&daemon, "other", "ops").await.unwrap();
    join(&daemon, &design.id, &ada.id).await.unwrap();
    join(&daemon, &ops.id, &ada.id).await.unwrap();

    allow(&daemon, &ada.id, &[]).await;
    allow(&daemon, &ada.id, &["other"]).await;
    assert!(
        members_in(&daemon, "other").await.is_empty(),
        "not resurrected"
    );
    assert_eq!(members_in(&daemon, "demo").await.len(), 1, "home stays");
    flush(&daemon).await;

    let restarted = spawn(&home, &[]);
    assert!(members_in(&restarted, "other").await.is_empty());
    assert_eq!(members_in(&restarted, "demo").await.len(), 1);
}

#[tokio::test]
async fn a_deleted_channel_takes_its_kept_posts_with_it() {
    let home = home();
    let daemon = spawn(&home, &[]);
    let design = channel(&daemon, "demo", "design").await.unwrap();
    post(&daemon, "demo", Some(&design.id), "draft").await;
    post(&daemon, "demo", None, "general").await;
    peers(&daemon, |reply| PeerCommand::ChannelsDelete {
        id: design.id.clone(),
        reply,
    })
    .await
    .unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    daemon
        .send(Command::Peers(PeerCommand::PostKeys { reply: tx }))
        .await;
    assert_eq!(rx.await.unwrap(), vec![("demo".to_string(), None)]);
    assert_eq!(feed(&daemon, None).await.len(), 2, "the records stay");
}
