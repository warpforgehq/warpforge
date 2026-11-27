//! Project config file watching.

use super::{dispatch, wire, ServerLifecycle};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::daemon::Daemon;
use crate::registry::ProjectEntry;
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn config_save_broadcasts_project_config_changed() {
    let project_dir = tempfile::tempdir().unwrap();
    let config_path = project_dir.path().join(".warpforge.yaml");
    std::fs::write(
        &config_path,
        "name: demo\nservices:\n  old:\n    command: old\n    port: 3000\n",
    )
    .unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: project_dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let handle = Daemon::spawn(projects, None);
    let mut events = handle.subscribe();
    std::fs::write(
            &config_path,
            "name: demo\nservices:\n  web:\n    command: bun dev\n    port: 5173\nportforwards:\n  - name: db\n    namespace: dev\n    pod: postgres\n    localPort: 5432\n    remotePort: 5432\n",
        )
        .unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let event = timeout(remaining, events.recv())
            .await
            .expect("project.configChanged event")
            .expect("daemon event");
        if let crate::daemon::Event::ProjectConfigChanged(config) = event {
            assert_eq!(config.project.declared_services, ["web"]);
            assert_eq!(config.services[0].command, "bun dev");
            assert_eq!(config.portforwards[0].name, "db");
            break;
        }
    }
}

#[tokio::test]
async fn local_override_file_edit_broadcasts_flagged_services() {
    let project_dir = tempfile::tempdir().unwrap();
    let warpforge = project_dir.path().join(".warpforge");
    std::fs::create_dir_all(&warpforge).unwrap();
    std::fs::write(
        warpforge.join("workspace.yaml"),
        "name: demo\nservices:\n  web:\n    command: bun dev\n    port: 5173\n  db:\n    command: pg\n    port: 5432\n",
    )
    .unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: project_dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let handle = Daemon::spawn(projects, None);
    let mut events = handle.subscribe();
    std::fs::write(
        warpforge.join("workspace.local.yaml"),
        "services:\n  web:\n    port: 5999\n  db: null\n",
    )
    .unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let event = timeout(remaining, events.recv())
            .await
            .expect("project.configChanged event")
            .expect("daemon event");
        if let crate::daemon::Event::ProjectConfigChanged(config) = event {
            assert_eq!(config.project.declared_services, ["web"]);
            assert_eq!(config.services[0].original_port, 5999);
            assert!(config.services[0].local);
            assert_eq!(config.services[0].local_fields, ["port"]);
            break;
        }
    }
    let ignore = std::fs::read_to_string(warpforge.join(".gitignore")).unwrap();
    assert!(ignore.contains("workspace.local.yaml"));
}

#[tokio::test]
async fn broken_local_file_keeps_shared_services_and_reports_the_error() {
    let project_dir = tempfile::tempdir().unwrap();
    let warpforge = project_dir.path().join(".warpforge");
    std::fs::create_dir_all(&warpforge).unwrap();
    std::fs::write(
        warpforge.join("workspace.yaml"),
        "name: demo\nservices:\n  web:\n    command: bun dev\n    port: 5173\n",
    )
    .unwrap();
    let local = warpforge.join("workspace.local.yaml");
    std::fs::write(&local, "services:\n  extra:\n    port: 1\n").unwrap();
    let projects = vec![ProjectEntry {
        name: "demo".into(),
        path: project_dir.path().to_string_lossy().into_owned(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }];
    let handle = Daemon::spawn(projects, None);
    let snapshot = handle.snapshot().await;
    assert_eq!(snapshot.projects[0].declared_services, ["web"]);
    let error = snapshot.projects[0].local_config_error.clone().unwrap();
    assert!(error.contains("workspace.local.yaml"), "{error}");

    let mut events = handle.subscribe();
    std::fs::write(&local, "services:\n  web:\n    port: 5999\n").unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let event = timeout(remaining, events.recv())
            .await
            .expect("project.configChanged event")
            .expect("daemon event");
        if let crate::daemon::Event::ProjectConfigChanged(config) = event {
            assert_eq!(config.project.local_config_error, None);
            assert_eq!(config.services[0].original_port, 5999);
            break;
        }
    }
}

const ORIGINAL: &str = "services:\n  web:\n    command: sleep 30\n    env: {MODE: original}\n";

fn demo(root: &std::path::Path) -> crate::daemon::actor::DaemonHandle {
    Daemon::spawn(
        vec![ProjectEntry {
            name: "demo".into(),
            path: root.display().to_string(),
            added_at: "0".into(),
            port_range: None,
            port_range_override: None,
        }],
        None,
    )
}

async fn rpc(
    handle: &crate::daemon::actor::DaemonHandle,
    method: &str,
    params: Value,
) -> Result<Value, wire::RpcError> {
    let lifecycle = Arc::new(ServerLifecycle::new(wire::DaemonOwner::External));
    let method = serde_json::from_value(json!({ "method": method, "params": params })).unwrap();
    dispatch(handle, method, &lifecycle).await
}

async fn read(handle: &crate::daemon::actor::DaemonHandle) -> Value {
    rpc(handle, "project.config.read", json!({ "project": "demo" }))
        .await
        .unwrap()
}

async fn write(
    handle: &crate::daemon::actor::DaemonHandle,
    scope: &str,
    text: &str,
    base: &Value,
) -> Result<Value, wire::RpcError> {
    rpc(
        handle,
        "project.config.write",
        json!({ "project": "demo", "scope": scope, "text": text, "base": base }),
    )
    .await
}

async fn changed(
    events: &mut tokio::sync::broadcast::Receiver<crate::daemon::Event>,
) -> wire::ProjectConfigState {
    timeout(Duration::from_secs(3), async {
        loop {
            if let crate::daemon::Event::ProjectConfigChanged(config) = events.recv().await.unwrap()
            {
                return config;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn writes_client_bytes_in_place_and_refuses_stale_or_invalid_edits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".workspace.yaml");
    std::fs::write(&path, ORIGINAL).unwrap();
    let handle = demo(dir.path());
    let initial = read(&handle).await;
    let base = &initial["shared"]["fingerprint"];
    assert!(base.is_string());
    assert_eq!(initial["effective"]["name"], "demo");
    assert_eq!(initial["shared"]["text"], ORIGINAL);

    let invalid = write(&handle, "shared", "services: [unclosed\n", base)
        .await
        .unwrap_err();
    assert!(matches!(
        invalid.code,
        wire::ErrorCode::ConfigInvalid {
            line: Some(_),
            column: Some(_)
        }
    ));
    assert_eq!(std::fs::read(&path).unwrap(), ORIGINAL.as_bytes());

    let text = "# Keep this comment\r\nservices: {}\r\nunknown: café\r\n";
    let mut events = handle.subscribe();
    let saved = write(&handle, "shared", text, base).await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), text.as_bytes());
    assert!(!dir.path().join(".warpforge/workspace.yaml").exists());
    assert_eq!(
        read(&handle).await["shared"]["fingerprint"],
        saved["fingerprint"]
    );
    assert!(handle.snapshot().await.services.is_empty());
    assert!(changed(&mut events).await.services.is_empty());

    let stale = write(&handle, "shared", ORIGINAL, base).await.unwrap_err();
    assert_eq!(
        serde_json::to_value(stale).unwrap(),
        json!({
            "code": "config_changed",
            "message": "Project config changed on disk",
            "fingerprint": saved["fingerprint"],
        })
    );
    assert_eq!(std::fs::read(&path).unwrap(), text.as_bytes());
}

#[tokio::test]
async fn local_writes_use_the_active_stem_and_validate_the_merge() {
    let dir = tempfile::tempdir().unwrap();
    let shared = dir.path().join(".workspace.yaml");
    let local = dir.path().join(".workspace.local.yaml");
    std::fs::write(&shared, ORIGINAL).unwrap();
    let handle = demo(dir.path());
    let initial = read(&handle).await;
    assert_eq!(
        initial["local"],
        json!({
            "path": local.display().to_string(),
            "exists": false,
            "text": "",
            "fingerprint": null,
        })
    );

    let invalid = write(
        &handle,
        "local",
        "services: {web: {command: null}}",
        &Value::Null,
    )
    .await
    .unwrap_err();
    assert!(matches!(
        invalid.code,
        wire::ErrorCode::ConfigInvalid { .. }
    ));
    assert!(!local.exists());

    let text = "services: {web: {env: {TEST: local}, readyTimeout: 2s}}\nports: {range: '4400'}\nworktree: {copy: ['*.env']}\n";
    let saved = write(&handle, "local", text, &Value::Null).await.unwrap();
    assert_eq!(std::fs::read_to_string(&local).unwrap(), text);
    assert_eq!(std::fs::read_to_string(&shared).unwrap(), ORIGINAL);
    let config = read(&handle).await;
    assert_eq!(config["local"]["fingerprint"], saved["fingerprint"]);
    let effective = &config["effective"];
    assert_eq!(
        effective["services"]["web"]["env"],
        json!({ "MODE": "original", "TEST": "local" })
    );
    assert_eq!(effective["ports"]["range"], "4400");
    assert_eq!(effective["worktree"]["copy"], json!(["*.env"]));
    assert_eq!(
        effective["localFields"],
        json!([
            ["ports", "range"],
            ["services", "web", "env", "TEST"],
            ["services", "web", "readyTimeout"],
            ["worktree", "copy"]
        ])
    );
    assert_eq!(handle.snapshot().await.projects[0].port_range, (4400, 4499));

    let invalid = write(
        &handle,
        "shared",
        "services: {}",
        &initial["shared"]["fingerprint"],
    )
    .await
    .unwrap_err();
    assert!(matches!(
        invalid.code,
        wire::ErrorCode::ConfigInvalid { .. }
    ));
    assert_eq!(std::fs::read_to_string(&shared).unwrap(), ORIGINAL);
}

#[tokio::test]
async fn only_a_missing_shared_config_creates_the_default_file() {
    let dir = tempfile::tempdir().unwrap();
    let handle = demo(dir.path());
    let path = dir.path().join(".warpforge/workspace.yaml");
    let initial = read(&handle).await;
    assert_eq!(initial["shared"]["fingerprint"], Value::Null);
    assert_eq!(initial["shared"]["path"], path.display().to_string());
    write(&handle, "shared", ORIGINAL, &Value::Null)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), ORIGINAL.as_bytes());
}

#[tokio::test]
async fn shared_diagnostic_broadcasts_and_clears_when_original_bytes_return() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".wf.yaml");
    std::fs::write(&path, ORIGINAL).unwrap();
    let handle = demo(dir.path());
    let mut events = handle.subscribe();
    std::fs::write(&path, "services: [broken\n").unwrap();

    let broken = changed(&mut events).await;
    let error = broken.project.config_error.unwrap();
    assert_eq!(error.file, path.display().to_string());
    assert!(error.line.is_some() && error.column.is_some());
    assert_eq!(broken.project.declared_services, ["web"]);
    assert_eq!(
        handle.snapshot().await.projects[0].config_error,
        Some(error.clone())
    );
    let reading = read(&handle).await;
    assert_eq!(reading["configError"], serde_json::to_value(error).unwrap());
    assert_eq!(
        reading["effective"]["services"]["web"]["command"],
        "sleep 30"
    );

    std::fs::write(&path, ORIGINAL).unwrap();
    assert!(changed(&mut events).await.project.config_error.is_none());
    assert!(handle.snapshot().await.projects[0].config_error.is_none());
}

#[tokio::test]
async fn running_service_reports_config_changes_without_restarting() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".wf.yaml"), ORIGINAL).unwrap();
    let handle = demo(dir.path());
    let params = json!({ "project": "demo", "service": "web" });
    rpc(&handle, "service.start", params.clone()).await.unwrap();
    let current = handle.snapshot().await;
    assert!(matches!(
        current.services[0].status,
        wire::ServiceStatus::Starting | wire::ServiceStatus::Running
    ));
    assert!(!current.services[0].needs_restart);
    let mut base = read(&handle).await["shared"]["fingerprint"].clone();
    let mut events = handle.subscribe();
    for text in [
        ORIGINAL.replace("original", "updated"),
        ORIGINAL.replace("command: sleep 30", "command: sleep 31"),
        ORIGINAL.replace("env:", "port: 3000\n    env:"),
    ] {
        let saved = write(&handle, "shared", &text, &base).await.unwrap();
        base = saved["fingerprint"].clone();
        let update = changed(&mut events).await;
        assert!(update.services[0].needs_restart);
        assert_eq!(update.services[0].command, "sleep 30");
        assert_eq!(update.services[0].original_port, 0);
        assert_eq!(
            update.services[0].allocated_port,
            current.services[0].allocated_port
        );
    }
    write(&handle, "shared", ORIGINAL, &base).await.unwrap();
    assert!(!changed(&mut events).await.services[0].needs_restart);
    rpc(&handle, "service.stop", params).await.unwrap();
}

#[tokio::test]
async fn unreadable_config_is_never_treated_as_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".workspace.yaml");
    std::fs::write(&path, [0xff, 0xfe]).unwrap();
    let handle = demo(dir.path());
    let error = write(&handle, "shared", ORIGINAL, &Value::Null)
        .await
        .unwrap_err();
    assert_eq!(error.code, wire::ErrorCode::Internal);
    assert_eq!(std::fs::read(&path).unwrap(), [0xff, 0xfe]);
    assert!(!dir.path().join(".warpforge/workspace.yaml").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn config_symlinks_cannot_reach_outside_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join(".workspace.yaml");
    std::fs::write(&target, ORIGINAL).unwrap();
    std::os::unix::fs::symlink(&target, dir.path().join(".workspace.yaml")).unwrap();
    let handle = demo(dir.path());
    assert!(
        rpc(&handle, "project.config.read", json!({ "project": "demo" }))
            .await
            .is_err()
    );
    assert!(write(&handle, "shared", "services: {}", &Value::Null)
        .await
        .is_err());
    assert_eq!(std::fs::read_to_string(&target).unwrap(), ORIGINAL);
}
