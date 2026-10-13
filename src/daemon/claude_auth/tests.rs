use super::*;

/// A stub `security` that stores items as files in a directory, so the swap
/// logic can be exercised without the real login keychain.
#[cfg(unix)]
pub(crate) fn stub_runtime(dir: &Path) -> ClaudeRuntime {
    let store = dir.join("keychain");
    std::fs::create_dir_all(&store).unwrap();
    let script = dir.join("security");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
store='{}'
cmd="$1"; shift
service=""; account=""; secret=""; want_w=0
while [ $# -gt 0 ]; do
  case "$1" in
-s) service="$2"; shift 2;;
-a) account="$2"; shift 2;;
-w) if [ "$cmd" = "add-generic-password" ]; then secret="$2"; shift 2; else want_w=1; shift; fi;;
-U) shift;;
*) shift;;
  esac
done
key=$(printf '%s' "$service/$account" | tr -c 'A-Za-z0-9' '_')
case "$cmd" in
  add-generic-password) printf '%s' "$secret" > "$store/$key"; exit 0;;
  find-generic-password) [ -f "$store/$key" ] || exit 44; cat "$store/$key"; exit 0;;
  delete-generic-password) rm -f "$store/$key"; exit 0;;
esac
exit 1
"#,
            store.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    ClaudeRuntime {
        config_dir: dir.join("config"),
        config_path: dir.join("config").join(".claude.json"),
        security_bin: Some(script),
        user: "tester".to_string(),
    }
}

#[test]
fn scoped_service_matches_claude_2_1_scheme() {
    let runtime = ClaudeRuntime {
        config_dir: PathBuf::from("/Users/tester/.claude"),
        config_path: PathBuf::from("/Users/tester/.claude.json"),
        security_bin: None,
        user: "tester".into(),
    };
    let service = runtime.scoped_service();
    assert!(service.starts_with("Claude Code-credentials-"), "{service}");
    // 8 hex chars of sha256, appended to the canonical service name.
    let suffix = service.trim_start_matches("Claude Code-credentials-");
    assert_eq!(suffix.len(), 8);
    assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    // Different config dirs must not collide.
    let other = ClaudeRuntime {
        config_dir: PathBuf::from("/Users/tester/.claude-work"),
        ..runtime.clone()
    };
    assert_ne!(runtime.scoped_service(), other.scoped_service());
}

#[cfg(unix)]
#[test]
fn live_credentials_round_trip_through_keychain_and_file() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = stub_runtime(dir.path());
    assert_eq!(runtime.read_live_credentials().unwrap(), None);

    runtime
        .write_live_credentials(r#"{"accessToken":"a"}"#)
        .unwrap();
    assert_eq!(
        runtime.read_live_credentials().unwrap().as_deref(),
        Some(r#"{"accessToken":"a"}"#)
    );
    // The canonical service is always written…
    assert_eq!(
        runtime
            .keychain_read(ACTIVE_SERVICE, &runtime.user)
            .unwrap(),
        Some(r#"{"accessToken":"a"}"#.to_string())
    );
    // …the scoped one is not invented when the CLI isn't using it, or reads
    // would prefer an item nobody else updates.
    assert_eq!(
        runtime
            .keychain_read(&runtime.scoped_service(), &runtime.user)
            .unwrap(),
        None
    );
    // …and no credentials file is invented next to a keychain-backed CLI:
    // nothing would keep it in step, and the CLI might read it later.
    assert!(!runtime.config_dir.join(CREDENTIALS_FILE).exists());
}

#[cfg(unix)]
#[test]
fn an_existing_credentials_file_is_kept_in_step() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = stub_runtime(dir.path());
    std::fs::create_dir_all(&runtime.config_dir).unwrap();
    std::fs::write(
        runtime.config_dir.join(CREDENTIALS_FILE),
        r#"{"accessToken":"old"}"#,
    )
    .unwrap();

    runtime
        .write_live_credentials(r#"{"accessToken":"new"}"#)
        .unwrap();

    let file = std::fs::read_to_string(runtime.config_dir.join(CREDENTIALS_FILE)).unwrap();
    assert_eq!(file, r#"{"accessToken":"new"}"#);
}

#[cfg(unix)]
#[test]
fn an_existing_scoped_item_is_kept_in_step() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = stub_runtime(dir.path());
    // A config dir whose CLI does use the scoped service (Claude 2.1+).
    runtime
        .keychain_write(
            &runtime.scoped_service(),
            &runtime.user,
            r#"{"accessToken":"old"}"#,
        )
        .unwrap();

    runtime
        .write_live_credentials(r#"{"accessToken":"new"}"#)
        .unwrap();

    // Both are updated: a stale scoped item would shadow the canonical one
    // on the next read and hand back the previous account's token.
    assert_eq!(
        runtime
            .keychain_read(&runtime.scoped_service(), &runtime.user)
            .unwrap(),
        Some(r#"{"accessToken":"new"}"#.to_string())
    );
    assert_eq!(
        runtime
            .keychain_read(ACTIVE_SERVICE, &runtime.user)
            .unwrap(),
        Some(r#"{"accessToken":"new"}"#.to_string())
    );
}

#[cfg(unix)]
#[test]
fn managed_credentials_are_per_account() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = stub_runtime(dir.path());
    runtime
        .write_managed_credentials("claude:work", r#"{"accessToken":"w"}"#)
        .unwrap();
    runtime
        .write_managed_credentials("claude:home", r#"{"accessToken":"h"}"#)
        .unwrap();
    assert_eq!(
        runtime.read_managed_credentials("claude:work").unwrap(),
        Some(r#"{"accessToken":"w"}"#.to_string())
    );
    runtime.delete_managed_credentials("claude:work").unwrap();
    assert_eq!(
        runtime.read_managed_credentials("claude:work").unwrap(),
        None
    );
    assert!(runtime
        .read_managed_credentials("claude:home")
        .unwrap()
        .is_some());
}

#[cfg(unix)]
#[test]
fn writing_the_oauth_account_preserves_the_rest_of_the_config() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = stub_runtime(dir.path());
    std::fs::create_dir_all(&runtime.config_dir).unwrap();
    // `.claude.json` also holds every project's history; a swap must not
    // cost the user any of it.
    std::fs::write(
        &runtime.config_path,
        r#"{"oauthAccount":{"emailAddress":"work@corp.com"},"projects":{"/a":{"history":[1,2]}},"userID":"u1"}"#,
    )
    .unwrap();

    runtime
        .write_live_oauth_account(&serde_json::json!({
            "emailAddress": "me@example.com",
            "organizationName": "Personal"
        }))
        .unwrap();

    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&runtime.config_path).unwrap()).unwrap();
    assert_eq!(config["oauthAccount"]["emailAddress"], "me@example.com");
    assert_eq!(config["projects"]["/a"]["history"][1], 2);
    assert_eq!(config["userID"], "u1");
    assert_eq!(
        runtime.read_live_oauth_account().unwrap()["organizationName"],
        "Personal"
    );
}

#[test]
fn unusable_credentials_are_recognised() {
    assert!(credentials_are_usable(r#"{"accessToken":"abc"}"#));
    assert!(credentials_are_usable(
        r#"{"claudeAiOauth":{"refreshToken":"abc"}}"#
    ));
    // The shapes a live CLI writes when it loses a refresh race.
    assert!(!credentials_are_usable(r#"{"accessToken":""}"#));
    assert!(!credentials_are_usable("{}"));
    assert!(!credentials_are_usable(""));
    assert!(!credentials_are_usable("not json"));
}

#[test]
fn auth_like_headers_are_detected() {
    assert!(headers_look_like_auth("Authorization: Bearer x"));
    assert!(headers_look_like_auth("x-api-key: abc"));
    assert!(!headers_look_like_auth("X-Trace-Id: 42"));
}
