use std::fs;
use std::path::Path;
use std::process::Command;

use super::*;
use crate::config::try_load_workspace_config;

const SHARED: &str = "
name: demo
ports:
  range: 4200-4299
services:
  db:
    command: docker compose up db
    port: 5432
  api:
    command: cargo run
    port: 8080
    env:
      LOG: info
      MODE: dev
    dependsOn: [db]
  analytics:
    command: bun analytics
    dependsOn: [db, api]
portforwards:
  - name: pg
    namespace: dev
    pod: postgres
    localPort: 5433
    remotePort: 5432
  - name: cache
    namespace: dev
    pod: redis
    localPort: 6380
    remotePort: 6379
worktree:
  copy: ['.env']
  setup: bun install
";

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn load(local: &str) -> WorkspaceConfig {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".warpforge/workspace.yaml", SHARED);
    write(dir.path(), ".warpforge/workspace.local.yaml", local);
    try_load_workspace_config(dir.path()).unwrap().unwrap()
}

fn load_err(local: &str) -> String {
    let config = load(local);
    assert!(config.local.services.is_empty() && config.local.portforwards.is_empty());
    assert_eq!(config.services.len(), 3, "shared config stays whole");
    config.local_error.expect("local_error is set")
}

#[test]
fn no_local_file_leaves_the_shared_config_untouched() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".warpforge/workspace.yaml", SHARED);
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.services.len(), 3);
    assert_eq!(config.local, LocalOverrides::default());
    write(
        dir.path(),
        ".warpforge/workspace.local.yaml",
        "# nothing yet\n",
    );
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.local, LocalOverrides::default());
    assert_eq!(config.services["api"].command, "cargo run");
}

#[test]
fn local_fields_replace_shared_fields() {
    let config = load("services:\n  api:\n    command: cargo run --release\n    port: 9090\n");
    let api = &config.services["api"];
    assert_eq!(api.command, "cargo run --release");
    assert_eq!(api.port, Some(9090));
    assert_eq!(api.depends_on, ["db"]);
    assert_eq!(config.local.services["api"], ["command", "port"]);
    assert!(!config.local.services.contains_key("db"));
}

#[test]
fn env_merges_per_key_and_null_unsets_a_key() {
    let config =
        load("services:\n  api:\n    env:\n      LOG: debug\n      EXTRA: '1'\n      MODE: null\n");
    let env = config.services["api"].env.as_ref().unwrap();
    assert_eq!(env["LOG"], "debug");
    assert_eq!(env["EXTRA"], "1");
    assert!(!env.contains_key("MODE"));
}

#[test]
fn lists_replace_entirely() {
    let config = load("services:\n  analytics:\n    dependsOn: [pg]\n");
    assert_eq!(config.services["analytics"].depends_on, ["pg"]);
}

#[test]
fn local_only_service_is_added() {
    let config = load("services:\n  mailhog:\n    command: mailhog\n    port: 8025\n");
    assert_eq!(config.services["mailhog"].port, Some(8025));
    assert_eq!(config.local.services["mailhog"], ["command", "port"]);
}

#[test]
fn null_service_is_removed() {
    let config = load("services:\n  db: null\n");
    assert!(!config.services.contains_key("db"));
    assert!(!config.local.services.contains_key("db"));
    assert!(config.services.contains_key("api"));
}

#[test]
fn forwards_merge_by_name_and_new_ones_are_appended() {
    let config = load(
        "portforwards:\n  - name: pg\n    localPort: 6000\n  - name: kafka\n    namespace: dev\n    pod: kafka\n    localPort: 9092\n    remotePort: 9092\n",
    );
    let names: Vec<_> = config
        .portforwards
        .iter()
        .map(|f| f.name.clone().unwrap())
        .collect();
    assert_eq!(names, ["pg", "cache", "kafka"]);
    assert_eq!(config.portforwards[0].local_port, 6000);
    assert_eq!(config.portforwards[0].remote_port, 5432);
    assert_eq!(config.local.portforwards["pg"], ["localPort"]);
    assert_eq!(
        config.local.portforwards["kafka"],
        ["namespace", "pod", "localPort", "remotePort"]
    );
    assert!(!config.local.portforwards.contains_key("cache"));
}

#[test]
fn forward_is_removed_with_remove_true() {
    let config =
        load("portforwards:\n  - name: pg\n    remove: true\n  - name: ghost\n    remove: true\n");
    let names: Vec<_> = config
        .portforwards
        .iter()
        .map(|f| f.name.clone().unwrap())
        .collect();
    assert_eq!(names, ["cache"]);
    assert!(config.local.portforwards.is_empty());
}

#[test]
fn top_level_maps_merge_per_key_and_scalars_replace() {
    let config = load(
        "name: mine\nports:\n  range: 4500-4599\nworktree:\n  setup: bun i --frozen-lockfile\n",
    );
    assert_eq!(config.name.as_deref(), Some("mine"));
    assert_eq!(config.ports.unwrap().range, "4500-4599");
    let worktree = config.worktree.unwrap();
    assert_eq!(worktree.copy, [".env"]);
    assert_eq!(worktree.setup.as_deref(), Some("bun i --frozen-lockfile"));
}

#[test]
fn legacy_root_config_takes_a_sibling_local_file() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".workspace.yaml", SHARED);
    write(
        dir.path(),
        ".workspace.local.yaml",
        "services:\n  db: null\n",
    );
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert!(!config.services.contains_key("db"));
}

#[test]
fn invalid_local_override_names_the_local_file() {
    let err = load_err("services:\n  broken:\n    port: 1\n");
    assert!(err.contains("workspace.local.yaml"), "{err}");
    assert!(err.contains("command"), "{err}");

    let err = load_err("worktree:\n  copy: ['../secret']\n");
    assert!(err.contains("workspace.local.yaml"), "{err}");

    let err = load_err("services: [unclosed\n");
    assert!(err.contains("workspace.local.yaml"), "{err}");

    let err = load_err("portforwards:\n  - localPort: 1\n");
    assert!(err.contains("workspace.local.yaml"), "{err}");
    assert!(err.contains("needs a `name`"), "{err}");
}

#[test]
fn invalid_shared_config_still_reports_the_shared_file() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".warpforge/workspace.yaml", "name: [broken\n");
    write(
        dir.path(),
        ".warpforge/workspace.local.yaml",
        "services: {}\n",
    );
    let err = format!("{:#}", try_load_workspace_config(dir.path()).unwrap_err());
    assert!(
        err.contains("workspace.yaml") && !err.contains("local"),
        "{err}"
    );
}

#[test]
fn local_file_applies_over_an_autodetected_config() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "package.json", r#"{"scripts":{"dev":"vite"}}"#);
    write(
        dir.path(),
        ".warpforge/workspace.local.yaml",
        "services:\n  app:\n    port: 3100\n",
    );
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.services["app"].port, Some(3100));
    assert_eq!(config.services["app"].command, "npm run dev");
}

#[test]
fn ignore_file_is_created_once_and_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    ensure_local_ignored(dir.path());
    assert!(!dir.path().join(".warpforge/.gitignore").exists());

    write(dir.path(), ".warpforge/workspace.local.yaml", "");
    ensure_local_ignored(dir.path());
    ensure_local_ignored(dir.path());
    let text = fs::read_to_string(dir.path().join(".warpforge/.gitignore")).unwrap();
    assert_eq!(text.matches("workspace.local.yaml").count(), 1);
    assert!(!dir.path().join(".gitignore").exists());
}

#[test]
fn existing_warpforge_gitignore_gets_one_appended_line() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".warpforge/workspace.local.yaml", "");
    write(dir.path(), ".warpforge/.gitignore", "cache/");
    ensure_local_ignored(dir.path());
    ensure_local_ignored(dir.path());
    let text = fs::read_to_string(dir.path().join(".warpforge/.gitignore")).unwrap();
    assert_eq!(text, "cache/\nworkspace.local.yaml\n");
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn local_file_stays_out_of_git_status() {
    for (shared, local) in [
        (
            ".warpforge/workspace.yaml",
            ".warpforge/workspace.local.yaml",
        ),
        (".workspace.yaml", ".workspace.local.yaml"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-q"]);
        write(dir.path(), shared, SHARED);
        git(dir.path(), &["add", "."]);
        git(
            dir.path(),
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-qm",
                "init",
            ],
        );
        write(dir.path(), local, "services:\n  db: null\n");
        ensure_local_ignored(dir.path());
        ensure_local_ignored(dir.path());
        assert_eq!(git(dir.path(), &["status", "--porcelain"]), "", "{local}");
        assert!(!dir.path().join(".gitignore").exists());
    }
}

#[test]
fn legacy_local_file_outside_git_is_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".workspace.local.yaml", "");
    ensure_local_ignored(dir.path());
    assert!(!dir.path().join(".gitignore").exists());
}

#[test]
fn fixing_or_removing_the_local_file_clears_the_error() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".warpforge/workspace.yaml", SHARED);
    let local = dir.path().join(".warpforge/workspace.local.yaml");
    fs::write(&local, "services:\n  broken:\n    port: 1\n").unwrap();
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    let error = config.local_error.unwrap();
    assert!(!error.contains(&*dir.path().to_string_lossy()), "{error}");

    fs::write(&local, "services:\n  db: null\n").unwrap();
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.local_error, None);
    assert!(!config.services.contains_key("db"));

    fs::write(&local, "services: [unclosed\n").unwrap();
    fs::remove_file(&local).unwrap();
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.local_error, None);
    assert!(config.services.contains_key("db"));
}

#[test]
fn legacy_agent_templates_are_ignored_in_shared_and_local_files() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        ".warpforge/workspace.yaml",
        "services: {web: {command: bun dev}}\nagentTemplates: {old: {command: old-agent}}\n",
    );
    write(
        dir.path(),
        ".warpforge/workspace.local.yaml",
        "services: {web: {port: 5173}}\nagentTemplates: {old: {command: local-agent}}\n",
    );
    let config = try_load_workspace_config(dir.path()).unwrap().unwrap();
    assert_eq!(config.services["web"].command, "bun dev");
    assert_eq!(config.services["web"].port, Some(5173));
    assert!(config.local_error.is_none());
    assert!(serde_yaml::to_value(config)
        .unwrap()
        .get("agentTemplates")
        .is_none());
}
