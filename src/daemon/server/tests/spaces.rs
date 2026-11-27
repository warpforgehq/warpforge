use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use warpforge_protocol::{self as wire, Method, Space, SpaceMember, SpaceMemberKey};

use crate::daemon::server::dispatch::dispatch_detached;
use crate::daemon::store::Store;
use crate::daemon::task::{Task, TaskStatus};
use crate::daemon::{Daemon, DaemonHandle};
use crate::registry::ProjectEntry;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/mock-acp-smith.mjs"
);

struct Home {
    dir: TempDir,
    previous: Option<OsString>,
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

impl Home {
    async fn new() -> Self {
        let lock = crate::registry::test_home_lock().await;
        let dir = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("WARPFORGE_HOME");
        std::env::set_var("WARPFORGE_HOME", dir.path().join("home"));
        Self {
            dir,
            previous,
            _lock: lock,
        }
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var("WARPFORGE_HOME", value);
        } else {
            std::env::remove_var("WARPFORGE_HOME");
        }
    }
}

fn entry(root: &Path, name: &str) -> ProjectEntry {
    let path = root.join(name);
    fs::create_dir(&path).unwrap();
    ProjectEntry {
        name: name.into(),
        path: path.canonicalize().unwrap().to_str().unwrap().into(),
        added_at: "0".into(),
        port_range: None,
        port_range_override: None,
    }
}

async fn rpc<T: serde::de::DeserializeOwned>(handle: &DaemonHandle, method: Method) -> T {
    serde_json::from_value(dispatch_detached(handle, method).await.unwrap()).unwrap()
}

fn project(name: &str) -> SpaceMember {
    SpaceMember::Project { name: name.into() }
}

#[tokio::test]
async fn space_rpc_persists_members_broadcasts_changes_and_refuses_duplicate_projects() {
    let home = Home::new().await;
    let primary = entry(home.path(), "primary");
    let folder = home.path().join("folder");
    fs::create_dir(&folder).unwrap();
    let folder = folder.to_str().unwrap().to_owned();
    let handle = Daemon::spawn(vec![primary], None);
    let mut events = handle.subscribe();

    let request: wire::Request = serde_json::from_value(json!({
        "id": 1, "method": "space.list", "params": {}
    }))
    .unwrap();
    assert!(rpc::<Vec<Space>>(&handle, request.method).await.is_empty());
    let first: Space = rpc(
        &handle,
        Method::SpaceCreate {
            name: "Product".into(),
        },
    )
    .await;
    let second: Space = rpc(
        &handle,
        Method::SpaceCreate {
            name: "Other".into(),
        },
    )
    .await;
    let first: Space = rpc(
        &handle,
        Method::SpaceRename {
            id: first.id,
            name: "Renamed".into(),
        },
    )
    .await;
    let first: Space = rpc(
        &handle,
        Method::SpaceAddMember {
            id: first.id,
            member: project("primary"),
        },
    )
    .await;
    let err = dispatch_detached(
        &handle,
        Method::SpaceAddMember {
            id: second.id.clone(),
            member: project("primary"),
        },
    )
    .await
    .unwrap_err();
    assert!(err.message.contains("Renamed"));
    let member = SpaceMember::Folder {
        path: folder.clone(),
        name: "Schemas".into(),
    };
    let first: Space = rpc(
        &handle,
        Method::SpaceAddMember {
            id: first.id,
            member: member.clone(),
        },
    )
    .await;
    assert_eq!(first.members, [project("primary"), member]);
    let first: Space = rpc(
        &handle,
        Method::SpaceRemoveMember {
            id: first.id,
            member: SpaceMemberKey::Folder { path: folder },
        },
    )
    .await;
    assert_eq!(first.members, [project("primary")]);
    let deleted: Space = rpc(
        &handle,
        Method::SpaceDelete {
            id: second.id.clone(),
        },
    )
    .await;
    assert_eq!(deleted, second);
    let listed: Vec<Space> = rpc(&handle, Method::SpaceList {}).await;
    assert_eq!(listed, [first]);
    assert_eq!(handle.snapshot().await.spaces, listed);
    let changed = std::iter::from_fn(|| events.try_recv().ok())
        .filter_map(|event| match crate::daemon::wire::to_wire(&event) {
            Some(wire::Event::SpacesChanged(spaces)) => Some(spaces),
            _ => None,
        })
        .last()
        .unwrap();
    assert_eq!(changed, listed);
    let saved: Value =
        serde_json::from_slice(&fs::read(home.path().join("home/spaces.json")).unwrap()).unwrap();
    assert_eq!(saved, json!({ "spaces": listed }));
    handle.shutdown().await;
}

async fn waiting(handle: &DaemonHandle, id: &str) -> Task {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let task = handle
                .tasks()
                .await
                .into_iter()
                .find(|task| task.id == id)
                .unwrap();
            match task.status {
                TaskStatus::Waiting => return task,
                TaskStatus::Blocked => panic!("task blocked: {:?}", task.blocked_reason),
                _ => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
    })
    .await
    .unwrap()
}

fn requests(log: &Path, method: &str) -> Vec<Value> {
    fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|event| event["method"] == method)
        .map(|event| event["params"].clone())
        .collect()
}

async fn start(handle: &DaemonHandle, log: &Path, capable: bool, worktree: bool) -> String {
    let capability = if capable {
        "additional-directories"
    } else {
        ""
    };
    handle
        .create_task(
            "primary",
            "make a change",
            &format!("node '{}' '{}' {capability}", FIXTURE, log.display()),
            vec![],
            false,
            worktree,
            None,
            vec![],
            None,
            Default::default(),
            None,
        )
        .await
}

fn git_init(path: &Path) {
    for args in [
        &["init", "-q"][..],
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "initial",
        ],
    ] {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[tokio::test]
async fn linked_siblings_skip_missing_folders_and_the_primary_owns_the_worktree() {
    let home = Home::new().await;
    let primary = entry(home.path(), "primary");
    let sibling = entry(home.path(), "backend");
    let schemas = home.path().join("schema-files");
    let alias = home.path().join("schemas");
    let root = Path::new(&primary.path);
    fs::create_dir(&schemas).unwrap();
    std::os::unix::fs::symlink(&schemas, &alias).unwrap();
    fs::create_dir(root.join(".warpforge")).unwrap();
    fs::write(
        root.join(".warpforge/workspace.yaml"),
        "name: primary\nlinked: [../backend, ../schemas, ../missing]\n",
    )
    .unwrap();
    git_init(root);
    git_init(sibling.path.as_ref());
    let projects = vec![primary.clone(), sibling.clone()];
    let db = home.path().join("tasks.db");
    let handle = Daemon::spawn(projects.clone(), Some(Store::open_at(&db).unwrap()));
    let listed: Vec<Space> = rpc(&handle, Method::SpaceList {}).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "primary");
    assert_eq!(
        listed[0].members,
        [
            project("primary"),
            project("backend"),
            SpaceMember::Folder {
                path: root
                    .parent()
                    .unwrap()
                    .join("schemas")
                    .to_str()
                    .unwrap()
                    .into(),
                name: "schemas".into()
            },
        ]
    );

    let offline = home.path().join("removable");
    fs::create_dir(&offline).unwrap();
    let _: Space = rpc(
        &handle,
        Method::SpaceAddMember {
            id: listed[0].id.clone(),
            member: SpaceMember::Folder {
                path: offline.to_str().unwrap().into(),
                name: "Offline".into(),
            },
        },
    )
    .await;
    fs::remove_dir(&offline).unwrap();

    let log = home.path().join("capable.log");
    let id = start(&handle, &log, true, true).await;
    let task = waiting(&handle, &id).await;
    let checkout = root.join(".warpforge/worktrees").join(&id);
    assert_eq!(task.project, primary.name);
    assert_eq!(task.worktree.as_deref(), checkout.to_str());
    let new = &requests(&log, "session/new")[0];
    assert_eq!(new["cwd"], checkout.to_str().unwrap());
    let roots = json!([
        sibling.path,
        root.parent().unwrap().join("schemas"),
        schemas.canonicalize().unwrap()
    ]);
    assert_eq!(new["additionalDirectories"], roots);
    let prompt = &requests(&log, "session/prompt")[0]["prompt"][0]["text"];
    assert!(prompt
        .as_str()
        .unwrap()
        .contains("backend (Git repository)"));

    let disabled = home.path().join("no-capability.log");
    let legacy = start(&handle, &disabled, false, false).await;
    waiting(&handle, &legacy).await;
    assert!(requests(&disabled, "session/new")[0]
        .get("additionalDirectories")
        .is_none());
    assert!(
        requests(&disabled, "session/prompt")[0]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("<workspace_folders>")
    );

    // Retire the declaration, then change the local space while the session is idle.
    fs::write(root.join(".warpforge/workspace.yaml"), "name: primary\n").unwrap();
    let _: Space = rpc(
        &handle,
        Method::SpaceDelete {
            id: listed[0].id.clone(),
        },
    )
    .await;
    handle.shutdown().await;

    let handle = Daemon::spawn(projects, Some(Store::open_at(&db).unwrap()));
    assert!(rpc::<Vec<Space>>(&handle, Method::SpaceList {})
        .await
        .is_empty());
    handle
        .session_prompt(&id, "continue", vec![])
        .await
        .unwrap();
    handle
        .session_prompt(&legacy, "continue", vec![])
        .await
        .unwrap();
    waiting(&handle, &id).await;
    waiting(&handle, &legacy).await;
    let load = &requests(&log, "session/load")[0];
    assert_eq!(load["cwd"], new["cwd"]);
    assert_eq!(
        serde_json::to_vec(&load["additionalDirectories"]).unwrap(),
        serde_json::to_vec(&new["additionalDirectories"]).unwrap()
    );
    assert!(requests(&disabled, "session/load")[0]
        .get("additionalDirectories")
        .is_none());
    let new_log = home.path().join("after-delete.log");
    let after_delete = start(&handle, &new_log, true, false).await;
    assert!(waiting(&handle, &after_delete)
        .await
        .workspace_folders
        .is_empty());
    assert!(requests(&new_log, "session/new")[0]
        .get("additionalDirectories")
        .is_none());
    handle.shutdown().await;
}
