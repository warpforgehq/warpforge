use super::*;

fn lines(mgr: &ServiceManager, service: &str) -> Vec<String> {
    mgr.log_window("p", service, 0, None).0
}

fn no_port() -> PortClaim {
    PortClaim {
        range: (4000, 4099),
        pin: ports::PortPin::Auto,
        port: 0,
        conflict: None,
    }
}

#[test]
fn dependency_gate_waits_goes_and_fails_naming_the_dependency() {
    let deps = vec!["db".to_string(), "cache".to_string()];
    let gate = |db: DepState, cache: DepState| {
        dependency_gate(&deps, |name| {
            if name == "db" {
                db.clone()
            } else {
                cache.clone()
            }
        })
    };
    assert_eq!(gate(DepState::Pending, DepState::Ready), Gate::Wait);
    assert_eq!(gate(DepState::Ready, DepState::Ready), Gate::Go);
    assert_eq!(
        gate(DepState::Unavailable("failed".into()), DepState::Pending),
        Gate::Fail("did not start: dependency db failed".into())
    );
    assert_eq!(
        gate(DepState::Ready, DepState::Unavailable("is stopped".into())),
        Gate::Fail("did not start: dependency cache is stopped".into())
    );
}

#[tokio::test]
async fn waiting_placeholder_has_no_process_and_can_start_or_fail() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    mgr.mark_waiting("p", "web", "true", no_port(), vec!["db".into()]);
    let svc = mgr.get("p", "web").unwrap();
    assert_eq!(svc.status, ServiceStatus::Starting);
    assert!(svc.pgid.is_none());
    assert_eq!(
        mgr.waiting_in_project("p"),
        vec![("web".into(), vec!["db".into()], false)]
    );
    assert_eq!(
        lines(&mgr, "web"),
        vec!["[service waiting for db]".to_string()]
    );

    mgr.start(
        "p",
        ".",
        (4000, 4099),
        ports::PortPin::Auto,
        "web",
        "sleep 30",
        0,
        None,
        &Readiness::default(),
        None,
    )
    .await
    .unwrap();
    assert!(
        mgr.get("p", "web").unwrap().pgid.is_some(),
        "a waiting entry must be startable"
    );
    assert!(mgr.waiting_in_project("p").is_empty());
    mgr.stop("p", "web").await.unwrap();

    mgr.mark_waiting("p", "api", "true", no_port(), vec!["db".into()]);
    mgr.fail_waiting(
        "p",
        "api",
        "true",
        no_port(),
        "did not start: dependency db failed".into(),
        vec!["db".into()],
    );
    let api = mgr.get("p", "api").unwrap();
    assert_eq!(api.status, ServiceStatus::Failed);
    assert_eq!(
        lines(&mgr, "api").last().map(String::as_str),
        Some("[service failed] did not start: dependency db failed")
    );
    assert_eq!(
        mgr.waiting_in_project("p"),
        vec![("api".into(), vec!["db".into()], true)],
        "a dependent failed on its dependency stays held so it can recover"
    );

    mgr.stop("p", "api").await.unwrap();
    assert!(
        mgr.waiting_in_project("p").is_empty(),
        "stopping releases the hold"
    );
}

/// Seeded directly: `mark_waiting` would allocate, and allocating needs a bind.
#[tokio::test]
async fn a_held_port_resolves_for_dependents_and_is_kept_at_start() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut mgr = ServiceManager::new(tx);
    mgr.services.insert(
        "p/api".into(),
        ManagedService {
            name: "api".into(),
            project_name: "p".into(),
            command: "sleep 30".into(),
            status: ServiceStatus::Starting,
            logs: Vec::new(),
            next_seq: 0,
            original_port: 4321,
            env: Default::default(),
            allocated_port: 4321,
            port_pinned: false,
            port_warning: None,
            pgid: None,
            alive: false,
            run_id: 90,
            waiting_on: vec!["db".into()],
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        },
    );
    let env = HashMap::from([(
        "API_URL".to_string(),
        "http://localhost:${api.port}".to_string(),
    )]);
    let range = (4300, 4399);
    mgr.start(
        "p",
        ".",
        range,
        ports::PortPin::Auto,
        "web",
        "echo \"web-sees-$API_URL\"; sleep 30",
        0,
        Some(&env),
        &Readiness::default(),
        None,
    )
    .await
    .unwrap();
    while !lines(&mgr, "web")
        .iter()
        .any(|l| l.starts_with("web-sees-"))
    {
        let event = timeout(Duration::from_secs(5), rx.recv()).await.unwrap();
        mgr.apply_event(event.unwrap());
    }
    assert!(
        lines(&mgr, "web").contains(&"web-sees-http://localhost:4321".to_string()),
        "{:?}",
        lines(&mgr, "web")
    );

    let claim = PortClaim {
        range,
        pin: ports::PortPin::Auto,
        port: 4321,
        conflict: None,
    };
    mgr.start(
        "p",
        ".",
        claim.range,
        claim.pin,
        "api",
        "sleep 30",
        claim.port,
        None,
        &Readiness::default(),
        None,
    )
    .await
    .unwrap();
    let api = mgr.get("p", "api").unwrap();
    assert!(api.process_alive());
    assert_eq!(api.allocated_port, 4321, "the reserved port is kept");
    mgr.stop_project("p").await.unwrap();
}
