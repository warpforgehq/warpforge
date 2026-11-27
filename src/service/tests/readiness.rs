use super::super::ready::{
    await_ready, format_duration, is_loopback, spawn_monitor, Outcome, RunHandle, Timing,
    DEFAULT_PROBE_INTERVAL, DEFAULT_READY_TIMEOUT,
};
use super::*;
use crate::config::{parse_duration, ServiceConfig, ServiceHealthcheck};
use std::sync::atomic::{AtomicUsize, Ordering};

fn starting(mgr: &mut ServiceManager, key: &str, run_id: u64) {
    mgr.services.insert(
        key.to_string(),
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
            run_id,
            waiting_on: Vec::new(),
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        },
    );
}

fn run_handle(tx: mpsc::UnboundedSender<ServiceEvent>, run_id: u64) -> RunHandle {
    RunHandle::new(tx, "p/web".into(), run_id, Arc::new(AtomicBool::new(false)))
}

fn timing(interval_ms: u64, timeout_ms: u64) -> Timing {
    Timing {
        interval: Duration::from_millis(interval_ms),
        timeout: Duration::from_millis(timeout_ms),
        recovery_interval: Duration::from_millis(interval_ms),
    }
}

/// A probe that fails until `ready` is set.
fn switchable_probe(
    ready: &Arc<AtomicBool>,
) -> impl FnMut() -> std::future::Ready<Result<(), String>> + Send + 'static {
    let ready = Arc::clone(ready);
    move || {
        std::future::ready(if ready.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err("http://localhost/health returned 503".to_string())
        })
    }
}

async fn next_event(rx: &mut mpsc::UnboundedReceiver<ServiceEvent>) -> ServiceEvent {
    timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("an event within 5s")
        .expect("channel open")
}

fn logs(mgr: &ServiceManager) -> Vec<String> {
    mgr.log_window("p", "web", 0, None).0
}

#[tokio::test]
async fn healthcheck_success_moves_service_to_running() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    starting(&mut mgr, "p/web", 1);
    let calls = Arc::new(AtomicUsize::new(0));
    let probe_calls = Arc::clone(&calls);
    spawn_monitor(run_handle(tx, 1), timing(5, 5000), move || {
        let n = probe_calls.fetch_add(1, Ordering::SeqCst);
        async move {
            if n < 2 {
                Err("http://localhost/health returned 503".to_string())
            } else {
                Ok(())
            }
        }
    });

    mgr.apply_event(next_event(&mut rx).await);
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Running);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn ready_timeout_fails_with_last_probe_error_and_keeps_process() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    starting(&mut mgr, "p/web", 1);
    let run = run_handle(tx, 1);
    let stopping = Arc::clone(&run.stopping);
    spawn_monitor(run, timing(10, 80), || async {
        Err("http://localhost/health returned 503".to_string())
    });

    let event = next_event(&mut rx).await;
    assert!(matches!(event, ServiceEvent::NotReady { .. }));
    mgr.apply_event(event);
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Failed);
    assert!(
        logs(&mgr).contains(
            &"[service failed] did not become ready within 80ms: http://localhost/health returned 503"
                .to_string()
        ),
        "{:?}",
        logs(&mgr)
    );
    assert!(
        !stopping.load(Ordering::SeqCst),
        "a timeout must not stop the process"
    );
}

#[tokio::test]
async fn timed_out_real_service_stays_alive_until_stopped() {
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
        "sleep 30",
        0,
        None,
        &readiness,
        None,
    )
    .await
    .unwrap();

    loop {
        let event = next_event(&mut rx).await;
        let not_ready = matches!(event, ServiceEvent::NotReady { .. });
        mgr.apply_event(event);
        if not_ready {
            break;
        }
    }
    let svc = mgr.get("p", "web").unwrap();
    assert_eq!(svc.status, ServiceStatus::Failed);
    assert!(svc.pgid.is_some(), "the process is left running");
    assert!(logs(&mgr)
        .iter()
        .any(|l| l.contains("did not become ready within 150ms: no log line matched")));
    mgr.stop("p", "web").await.unwrap();
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Stopped);
}

#[test]
fn stale_run_readiness_results_are_ignored() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    starting(&mut mgr, "p/web", 2);

    mgr.apply_event(ServiceEvent::NotReady {
        key: "p/web".into(),
        run_id: 1,
        reason: "did not become ready within 2m: old run".into(),
    });
    mgr.apply_event(ServiceEvent::StatusChange {
        key: "p/web".into(),
        run_id: 1,
        status: ServiceStatus::Running,
        exit_code: None,
    });
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Starting);
    assert!(logs(&mgr).is_empty());
}

#[test]
fn not_ready_after_running_is_ignored() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    starting(&mut mgr, "p/web", 1);
    mgr.get_mut("p", "web").unwrap().status = ServiceStatus::Running;
    mgr.apply_event(ServiceEvent::NotReady {
        key: "p/web".into(),
        run_id: 1,
        reason: "late".into(),
    });
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Running);
}

#[test]
fn a_run_settles_only_once() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let run = run_handle(tx, 1);
    assert!(run.settle());
    assert!(!run.settle());
}

#[tokio::test]
async fn stopping_abandons_the_probe() {
    let outcome = await_ready(
        &mut || async { Err::<(), _>("down".to_string()) },
        Duration::from_millis(5),
        Duration::from_secs(5),
        || true,
    )
    .await;
    assert_eq!(outcome, Outcome::Abandoned);
}

#[test]
fn durations_parse_and_reject_garbage() {
    assert_eq!(parse_duration("100ms"), Some(Duration::from_millis(100)));
    assert_eq!(parse_duration("5s"), Some(Duration::from_secs(5)));
    assert_eq!(parse_duration("2m"), Some(Duration::from_secs(120)));
    assert_eq!(parse_duration("10min"), Some(Duration::from_secs(600)));
    assert_eq!(parse_duration("1h"), Some(Duration::from_secs(3600)));
    assert_eq!(parse_duration(" 30s "), Some(Duration::from_secs(30)));
    for bad in ["", "5", "fast", "0s", "-1s", "1.5s", "5d", "1h30m"] {
        assert_eq!(parse_duration(bad), None, "{bad:?}");
    }
    assert_eq!(format_duration(Duration::from_secs(120)), "2m");
    assert_eq!(format_duration(Duration::from_secs(90)), "90s");
    assert_eq!(format_duration(Duration::from_millis(1500)), "1500ms");
}

fn service(yaml: &str) -> ServiceConfig {
    serde_yaml::from_str(yaml).unwrap()
}

#[test]
fn readiness_config_defaults_and_overrides() {
    let bare = Readiness::from_config(&service("command: dev"));
    assert_eq!(bare, Readiness::default());
    assert_eq!(bare.interval, Duration::from_secs(1));
    assert_eq!(bare.timeout, Duration::from_secs(300));
    assert_eq!(DEFAULT_PROBE_INTERVAL, bare.interval);
    assert_eq!(DEFAULT_READY_TIMEOUT, bare.timeout);

    let tuned = Readiness::from_config(&service(
        "command: dev\nreadyTimeout: 90s\nhealthcheck:\n  url: http://localhost:${web.port}/health\n  interval: 250ms",
    ));
    assert_eq!(
        tuned.healthcheck_url.as_deref(),
        Some("http://localhost:${web.port}/health")
    );
    assert_eq!(tuned.interval, Duration::from_millis(250));
    assert_eq!(tuned.timeout, Duration::from_secs(90));

    let invalid = Readiness::from_config(&ServiceConfig {
        ready_timeout: Some("soon".into()),
        healthcheck: Some(ServiceHealthcheck {
            url: "http://localhost/".into(),
            interval: None,
        }),
        ..service("command: dev")
    });
    assert_eq!(invalid.interval, DEFAULT_PROBE_INTERVAL);
    assert_eq!(invalid.timeout, DEFAULT_READY_TIMEOUT);
}

#[tokio::test]
async fn late_ready_after_timeout_recovers_to_running() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    starting(&mut mgr, "p/web", 1);
    let ready = Arc::new(AtomicBool::new(false));
    spawn_monitor(run_handle(tx, 1), timing(10, 50), switchable_probe(&ready));

    let timed_out = next_event(&mut rx).await;
    assert!(matches!(timed_out, ServiceEvent::NotReady { .. }));
    mgr.apply_event(timed_out);
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Failed);

    ready.store(true, Ordering::SeqCst);
    let late = next_event(&mut rx).await;
    assert!(matches!(late, ServiceEvent::LateReady { run_id: 1, .. }));
    mgr.apply_event(late);
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Running);
    assert!(
        logs(&mgr)
            .last()
            .unwrap()
            .starts_with("[service ready] after "),
        "{:?}",
        logs(&mgr)
    );
}

#[tokio::test]
async fn probe_that_stays_down_stays_failed() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    starting(&mut mgr, "p/web", 1);
    let run = run_handle(tx, 1);
    let stopping = Arc::clone(&run.stopping);
    spawn_monitor(
        run,
        timing(10, 50),
        switchable_probe(&Arc::new(AtomicBool::new(false))),
    );

    mgr.apply_event(next_event(&mut rx).await);
    assert!(
        timeout(Duration::from_millis(300), rx.recv())
            .await
            .is_err(),
        "a probe that stays down reports nothing after the timeout"
    );
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Failed);
    stopping.store(true, Ordering::SeqCst);
}

#[tokio::test]
async fn stopped_run_never_flips_late() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    starting(&mut mgr, "p/web", 1);
    let run = run_handle(tx, 1);
    let stopping = Arc::clone(&run.stopping);
    let ready = Arc::new(AtomicBool::new(false));
    spawn_monitor(run, timing(10, 50), switchable_probe(&ready));

    mgr.apply_event(next_event(&mut rx).await);
    stopping.store(true, Ordering::SeqCst);
    mgr.get_mut("p", "web").unwrap().status = ServiceStatus::Stopped;
    ready.store(true, Ordering::SeqCst);
    assert!(
        timeout(Duration::from_millis(300), rx.recv())
            .await
            .is_err(),
        "a stopped run must not report ready"
    );

    mgr.apply_event(ServiceEvent::LateReady {
        key: "p/web".into(),
        run_id: 1,
        after: Duration::from_secs(1),
    });
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Stopped);
}

#[tokio::test]
async fn healthcheck_on_its_own_undeclared_port_names_the_problem() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    let readiness = Readiness {
        healthcheck_url: Some("http://localhost:${web.port}/health".into()),
        ..Readiness::default()
    };
    mgr.start(
        "p",
        ".",
        (4000, 4099),
        ports::PortPin::Auto,
        "web",
        "sleep 30",
        0,
        None,
        &readiness,
        None,
    )
    .await
    .unwrap();
    assert_eq!(mgr.get("p", "web").unwrap().status, ServiceStatus::Failed);
    assert_eq!(
        logs(&mgr).last().map(String::as_str),
        Some("[service failed] healthcheck url references ${web.port} but web declares no port")
    );
}

#[test]
fn only_loopback_healthchecks_may_use_self_signed_certificates() {
    for url in [
        "https://localhost:4210/health",
        "https://127.0.0.1:4210/",
        "https://[::1]:4210/",
    ] {
        assert!(is_loopback(url), "{url}");
    }
    for url in [
        "https://example.com/health",
        "https://10.0.0.5/",
        "https://localhost.example.com/",
        "not a url",
    ] {
        assert!(!is_loopback(url), "{url}");
    }
}
