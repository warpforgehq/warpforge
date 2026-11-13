//! A keeper's checker follows its file: another agent or model retires the
//! old checker for a fresh one; the same agent and model reuse it.

use super::*;

const READY: &str = "version: 1\npreset: security\n";

async fn check_ready(setup: &Setup) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ask = KeeperCommand::CheckReady {
        task_id: "t_a".into(),
        reply: tx,
    };
    setup.daemon.send(Command::Keepers(ask)).await;
    assert_eq!(rx.await.unwrap().unwrap().1, vec!["security"]);
}

fn rewrite(setup: &Setup, yaml: &str) {
    let path = format!(
        "{}/.warpforge/keepers/security.yaml",
        setup.projects[0].path
    );
    std::fs::write(path, yaml).unwrap();
}

async fn run_once(setup: &mut Setup, number: u64) -> String {
    check_ready(setup).await;
    let (run, _) = keeper_event(setup, |run| finished(run) && run.run_number == number).await;
    run.checker_task_id.expect("the run names its checker")
}

async fn only_checker(setup: &Setup) -> Task {
    timeout(Duration::from_secs(10), async {
        loop {
            let mut all = checkers(&setup.daemon).await;
            if all.len() == 1 {
                return all.remove(0);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("one checker left")
}

#[tokio::test]
async fn a_changed_agent_or_model_replaces_the_checker() {
    let keeper = format!("{READY}agent: mockkeep\n");
    let mut setup = setup(&[("security", &keeper)], |wt| vec![task("t_a", Some(wt))]).await;
    std::fs::write(&setup.replies, APPROVE).unwrap();
    let first = run_once(&mut setup, 1).await;
    wait_idle(&setup.daemon, &first).await;

    let reused = run_once(&mut setup, 2).await;
    assert_eq!(reused, first, "the same agent and model reuse the checker");
    wait_idle(&setup.daemon, &first).await;

    rewrite(&setup, &format!("{READY}agent: mockalt\n"));
    let second = run_once(&mut setup, 3).await;
    assert_ne!(second, first, "another agent starts a fresh checker");
    let checker = only_checker(&setup).await;
    assert_eq!(
        (checker.id.as_str(), checker.agent.as_str()),
        (second.as_str(), "mockalt")
    );
    wait_idle(&setup.daemon, &second).await;

    rewrite(&setup, &format!("{READY}agent: mockalt\nmodel: haiku\n"));
    let third = run_once(&mut setup, 4).await;
    assert_ne!(third, second, "another model starts a fresh checker");
    let checker = only_checker(&setup).await;
    assert_eq!(
        (checker.id, checker.model),
        (third, Some("haiku".to_string()))
    );
    setup.daemon.shutdown().await;
}
