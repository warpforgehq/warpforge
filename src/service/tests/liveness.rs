//! Liveness of a run: a timed-out run stays alive and its later exit is
//! recorded, and no ready report outlives the exit it raced with.

use super::*;

fn starting(mgr: &mut ServiceManager) {
    mgr.services.insert(
        "p/web".into(),
        ManagedService {
            name: "web".into(),
            project_name: "p".into(),
            command: "dev".into(),
            status: ServiceStatus::Starting,
            logs: Vec::new(),
            next_seq: 0,
            original_port: 0,
            env: Default::default(),
            allocated_port: 0,
            port_pinned: false,
            port_warning: None,
            pgid: None,
            alive: true,
            run_id: 1,
            waiting_on: Vec::new(),
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        },
    );
}

fn logs(mgr: &ServiceManager) -> Vec<String> {
    mgr.log_window("p", "web", 0, None).0
}

fn status(mgr: &ServiceManager) -> ServiceStatus {
    mgr.get("p", "web").unwrap().status.clone()
}

fn late_ready() -> ServiceEvent {
    ServiceEvent::LateReady {
        key: "p/web".into(),
        run_id: 1,
        after: Duration::from_secs(300),
    }
}

#[tokio::test]
async fn a_timed_out_run_is_alive_and_its_later_crash_is_logged() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    let readiness = Readiness {
        pattern: Some("never printed".into()),
        timeout: Duration::from_millis(150),
        ..Readiness::default()
    };
    mgr.start(
        "p",
        ".",
        (4000, 4099),
        ports::PortPin::Auto,
        "web",
        "sleep 0.6; exit 3",
        0,
        None,
        &readiness,
        None,
    )
    .await
    .unwrap();

    let mut timed_out_alive = false;
    loop {
        let event = timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("an event within 5s")
            .unwrap();
        let not_ready = matches!(event, ServiceEvent::NotReady { .. });
        let exit = matches!(event, ServiceEvent::StatusChange { .. });
        mgr.apply_event(event);
        if not_ready {
            timed_out_alive = mgr.get("p", "web").unwrap().process_alive();
        }
        if exit {
            break;
        }
    }
    assert!(timed_out_alive, "a timeout leaves the run alive");
    assert_eq!(status(&mgr), ServiceStatus::Failed);
    assert!(!mgr.get("p", "web").unwrap().process_alive());
    assert_eq!(
        logs(&mgr).last().map(String::as_str),
        Some("[service failed: exit code=3]"),
        "{:?}",
        logs(&mgr)
    );
}

#[test]
fn a_late_ready_that_overtakes_its_not_ready_still_wins() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    starting(&mut mgr);
    mgr.apply_event(late_ready());
    mgr.apply_event(ServiceEvent::NotReady {
        key: "p/web".into(),
        run_id: 1,
        reason: "did not become ready within 5m: down".into(),
    });
    assert_eq!(status(&mgr), ServiceStatus::Running);
    assert_eq!(logs(&mgr), vec!["[service ready] after 5m".to_string()]);
}

#[test]
fn no_ready_report_outlives_the_exit() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    starting(&mut mgr);
    mgr.apply_event(ServiceEvent::StatusChange {
        key: "p/web".into(),
        run_id: 1,
        status: ServiceStatus::Failed,
        exit_code: Some(1),
    });
    mgr.apply_event(ServiceEvent::StatusChange {
        key: "p/web".into(),
        run_id: 1,
        status: ServiceStatus::Running,
        exit_code: None,
    });
    mgr.apply_event(late_ready());
    assert_eq!(status(&mgr), ServiceStatus::Failed);
    assert_eq!(
        logs(&mgr),
        vec!["[service failed: exit code=1]".to_string()]
    );
}

/// procps `kill -9 -<pgid>` without `--` sent SIGKILL to the caller's own
/// group, so on Linux this stop took the test binary down with the service.
#[cfg(unix)]
#[tokio::test]
async fn a_group_kill_reaches_the_service_group_and_not_ours() {
    bounded(async {
        let mut child = tokio::process::Command::new("sh")
            .args(["-c", "sleep 30 & wait"])
            .process_group(0)
            .spawn()
            .unwrap();
        let pgid = child.id().unwrap();
        assert!(pgid > 9, "a multi-digit group is the case procps got wrong");

        super::super::stop::kill_group(Some(pgid)).await;
        let status = child.wait().await.unwrap();
        assert_eq!(
            std::os::unix::process::ExitStatusExt::signal(&status),
            Some(libc::SIGKILL)
        );
    })
    .await
}
