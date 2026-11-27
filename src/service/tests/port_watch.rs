use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::port_watch::{
    announced_port, assess, spawn_port_watch, PortWarning, WatchTiming,
};
use super::*;

fn warning(expected: u16, listening: &[u16]) -> Option<PortWarning> {
    Some(PortWarning {
        expected,
        listening: listening.to_vec(),
    })
}

#[test]
fn announced_port_reads_dev_server_banners() {
    let cases = [
        ("  ➜  Local:   http://localhost:5173/", Some(5173)),
        ("[astro] 🚀 astro  v5.0.0 started in 20ms\n", None),
        ("┃ Local    http://localhost:4321/", Some(4321)),
        ("   - Local:        http://localhost:3000", Some(3000)),
        ("* Listening on http://127.0.0.1:3000", Some(3000)),
        ("* Listening on tcp://0.0.0.0:3001", Some(3001)),
        ("Listening on [::1]:8080", Some(8080)),
        ("no url here", None),
        ("localhost: nothing", None),
    ];
    for (line, expected) in cases {
        assert_eq!(announced_port(line), expected, "{line}");
    }
}

#[test]
fn announced_port_ignores_ansi_codes() {
    let line = "\u{1b}[32m  ➜\u{1b}[39m  \u{1b}[1mLocal\u{1b}[22m:   http://localhost:\u{1b}[1m5173\u{1b}[22m/";
    assert_eq!(announced_port(line), Some(5173));
    assert_eq!(
        announced_port("\u{1b}[1mhttp://localhost:4321\u{1b}[0m"),
        Some(4321)
    );
}

#[test]
fn an_answering_port_clears_the_warning() {
    assert_eq!(assess(4400, true, true, &[4321]), None);
}

#[test]
fn a_silent_port_of_a_running_service_warns_with_the_listening_ports() {
    assert_eq!(
        assess(4400, false, true, &[4321, 8787]),
        warning(4400, &[4321, 8787])
    );
}

#[test]
fn the_expected_port_is_not_reported_as_listening() {
    assert_eq!(
        assess(4400, false, true, &[4400, 4321]),
        warning(4400, &[4321])
    );
}

#[test]
fn a_starting_service_stays_quiet_until_another_port_answers() {
    assert_eq!(assess(4400, false, false, &[]), None);
    assert_eq!(assess(4400, false, false, &[4321]), warning(4400, &[4321]));
}

#[test]
fn a_running_service_with_no_answering_port_warns_without_one() {
    assert_eq!(assess(4400, false, true, &[]), warning(4400, &[]));
}

fn running(mgr: &mut ServiceManager) {
    let svc = mgr.services.get_mut("p/web").unwrap();
    svc.status = ServiceStatus::Running;
    svc.allocated_port = 4400;
}

fn probe(run_id: u64, answered: bool, listening: &[u16]) -> ServiceEvent {
    ServiceEvent::PortProbe {
        key: "p/web".into(),
        run_id,
        answered,
        listening: listening.to_vec(),
    }
}

#[test]
fn probe_results_set_and_clear_the_warning_for_the_current_run() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    readiness_seed(&mut mgr);
    running(&mut mgr);

    mgr.apply_event(probe(7, false, &[4321]));
    assert_eq!(
        mgr.get("p", "web").unwrap().port_warning,
        warning(4400, &[4321])
    );

    mgr.apply_event(probe(8, true, &[]));
    assert_eq!(
        mgr.get("p", "web").unwrap().port_warning,
        warning(4400, &[4321])
    );

    mgr.apply_event(probe(7, true, &[]));
    assert_eq!(mgr.get("p", "web").unwrap().port_warning, None);
}

#[test]
fn an_exited_run_drops_its_warning() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    readiness_seed(&mut mgr);
    running(&mut mgr);
    mgr.apply_event(probe(7, false, &[]));

    mgr.apply_event(ServiceEvent::StatusChange {
        key: "p/web".into(),
        run_id: 7,
        status: ServiceStatus::Failed,
        exit_code: Some(1),
    });
    assert_eq!(mgr.get("p", "web").unwrap().port_warning, None);
    mgr.apply_event(probe(7, false, &[]));
    assert_eq!(mgr.get("p", "web").unwrap().port_warning, None);
}

#[tokio::test]
async fn an_unresolved_port_reference_in_the_command_fails_the_start() {
    bounded(async {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut mgr = ServiceManager::new(tx);
        mgr.start(
            "p",
            ".",
            (4000, 4099),
            ports::PortPin::Auto,
            "web",
            "echo --port ${api.port}",
            0,
            None,
            &Readiness::default(),
            None,
        )
        .await
        .unwrap();

        let svc = mgr.get("p", "web").unwrap();
        assert_eq!(svc.status, ServiceStatus::Failed);
        assert!(logs_of(&mgr)
            .iter()
            .any(|l| l.contains("command references ${api.port}")));
    })
    .await
}

/// Needs to bind a port from the range, which a sandbox may forbid.
#[tokio::test]
async fn a_command_receives_the_interpolated_port() {
    bounded(async {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut mgr = ServiceManager::new(tx);
        mgr.start(
            "p",
            ".",
            (4000, 4099),
            ports::PortPin::Auto,
            "web",
            "echo port=${web.port}",
            3000,
            None,
            &Readiness::default(),
            None,
        )
        .await
        .unwrap();
        let port = mgr.get("p", "web").unwrap().allocated_port;
        assert!(port > 0);

        let wanted = format!("port={port}");
        while let Ok(Some(ev)) = timeout(Duration::from_secs(5), rx.recv()).await {
            if let ServiceEvent::Log { line, .. } = &ev {
                if *line == wanted {
                    return;
                }
            }
        }
        panic!("expected the command to print {wanted}");
    })
    .await
}

const FAST: WatchTiming = WatchTiming {
    grace: Duration::from_millis(1),
    interval: Duration::from_millis(5),
};

/// Watch `p/web` with a probe where only announced port 4321 answers; returns its call count.
fn watch(
    mgr: &mut ServiceManager,
    tx: mpsc::UnboundedSender<ServiceEvent>,
    timing: WatchTiming,
) -> Arc<AtomicUsize> {
    let probes = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&probes);
    let svc = mgr.services.get_mut("p/web").unwrap();
    let run = RunHandle::new(tx, "p/web".into(), svc.run_id, Arc::clone(&svc.stopping));
    run.announce("Local: http://localhost:4321/");
    let probe = move |port| {
        counter.fetch_add(1, Ordering::SeqCst);
        std::future::ready(port == 4321)
    };
    svc.port_watch = Some(spawn_port_watch(run, svc.allocated_port, timing, probe));
    probes
}

fn probing_run(mgr: &ServiceManager, tx: mpsc::UnboundedSender<ServiceEvent>) -> RunHandle {
    let svc = mgr.get("p", "web").unwrap();
    RunHandle::new(tx, "p/web".into(), svc.run_id, Arc::clone(&svc.stopping))
}

async fn first_probe(
    announced: &[&str],
    answering: &'static [u16],
    calls: Arc<std::sync::Mutex<Vec<u16>>>,
) -> Vec<u16> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx.clone());
    readiness_seed(&mut mgr);
    running(&mut mgr);
    let run = probing_run(&mgr, tx);
    for line in announced {
        run.announce(line);
    }
    let probe = move |port| {
        calls.lock().unwrap().push(port);
        std::future::ready(answering.contains(&port))
    };
    let _guard = spawn_port_watch(run, 4400, FAST, probe);
    match rx.recv().await.unwrap() {
        ServiceEvent::PortProbe { listening, .. } => listening,
        _ => panic!("expected a port probe"),
    }
}

#[tokio::test]
async fn only_announced_ports_that_answer_are_reported() {
    bounded(async {
        let calls = Arc::default();
        let lines = ["api on localhost:8787", "Studio at localhost:9501"];
        let listening = first_probe(&lines, &[8787], Arc::clone(&calls)).await;
        assert_eq!(listening, vec![8787]);
        assert!(calls.lock().unwrap().contains(&9501));
    })
    .await
}

#[tokio::test]
async fn several_answering_ports_are_all_reported() {
    bounded(async {
        let lines = ["localhost:9501", "localhost:8787"];
        let listening = first_probe(&lines, &[8787, 9501], Arc::default()).await;
        assert_eq!(listening, vec![8787, 9501]);
    })
    .await
}

#[tokio::test]
async fn no_answering_announced_port_reports_none() {
    bounded(async {
        let listening = first_probe(&["localhost:9501"], &[], Arc::default()).await;
        assert!(listening.is_empty());
    })
    .await
}

#[tokio::test]
async fn at_most_five_candidates_are_probed_and_an_answer_is_cached() {
    bounded(async {
        let calls = Arc::default();
        let lines: Vec<String> = (9001..9009).map(|p| format!("localhost:{p}")).collect();
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        first_probe(&refs, &[9008], Arc::clone(&calls)).await;
        let probed = calls.lock().unwrap().clone();
        assert_eq!(probed.len(), 6, "{probed:?}");
        assert!(!probed.contains(&9001));
    })
    .await
}

async fn probing_stopped(probes: &AtomicUsize) -> bool {
    let before = probes.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(50)).await;
    probes.load(Ordering::SeqCst) == before
}

#[tokio::test]
async fn stop_returns_promptly_and_ends_an_active_probe_loop() {
    bounded(async {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut mgr = ServiceManager::new(tx.clone());
        readiness_seed(&mut mgr);
        running(&mut mgr);
        let probes = watch(&mut mgr, tx, FAST);

        for _ in 0..3 {
            let event = rx.recv().await.unwrap();
            mgr.apply_event(event);
        }
        assert_eq!(
            mgr.get("p", "web").unwrap().port_warning,
            warning(4400, &[4321])
        );

        timeout(Duration::from_secs(1), mgr.stop("p", "web"))
            .await
            .expect("stop must not wait on the watcher")
            .unwrap();
        assert!(
            probing_stopped(&probes).await,
            "probing continued after stop"
        );
        assert_eq!(mgr.get("p", "web").unwrap().port_warning, None);
    })
    .await
}

#[tokio::test]
async fn an_exited_run_ends_its_watcher_without_a_stop() {
    bounded(async {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut mgr = ServiceManager::new(tx.clone());
        readiness_seed(&mut mgr);
        running(&mut mgr);
        let probes = watch(&mut mgr, tx, FAST);
        let event = rx.recv().await.unwrap();
        mgr.apply_event(event);

        mgr.apply_event(ServiceEvent::StatusChange {
            key: "p/web".into(),
            run_id: 7,
            status: ServiceStatus::Failed,
            exit_code: Some(1),
        });
        assert!(
            probing_stopped(&probes).await,
            "probing continued after exit"
        );
    })
    .await
}

#[tokio::test]
async fn shutdown_does_not_wait_out_a_watcher_grace_period() {
    bounded(async {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut mgr = ServiceManager::new(tx.clone());
        readiness_seed(&mut mgr);
        running(&mut mgr);
        let idle = WatchTiming {
            grace: Duration::from_secs(3600),
            interval: Duration::from_secs(3600),
        };
        let probes = watch(&mut mgr, tx, idle);

        timeout(Duration::from_secs(1), mgr.stop_all())
            .await
            .expect("shutdown must not wait on the watcher")
            .unwrap();
        drop(mgr);
        // The watcher holds the last sender, so the channel closes only once it is gone.
        let closed = timeout(Duration::from_secs(1), rx.recv()).await;
        assert!(matches!(closed, Ok(None)), "the watcher outlived shutdown");
        assert_eq!(probes.load(Ordering::SeqCst), 0);
    })
    .await
}

fn logs_of(mgr: &ServiceManager) -> Vec<String> {
    mgr.log_window("p", "web", 0, None).0
}

fn readiness_seed(mgr: &mut ServiceManager) {
    mgr.services.insert(
        "p/web".to_string(),
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
            run_id: 7,
            waiting_on: Vec::new(),
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        },
    );
}
