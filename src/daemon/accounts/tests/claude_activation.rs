//! Claude account activation end to end: a temp accounts root and a stubbed
//! keychain, so the credential swap runs without touching the real login.

use std::path::Path;

use crate::daemon::store::StoredAccount;

use super::super::*;
use super::account;

/// Build two Claude accounts inside a temp accounts-root, with a stubbed
/// keychain, so activation can be exercised end to end.
#[cfg(unix)]
fn claude_fixture(
    root: &Path,
) -> (
    crate::daemon::claude_auth::ClaudeRuntime,
    StoredAccount,
    StoredAccount,
) {
    let runtime = crate::daemon::claude_auth::tests::stub_runtime(root);
    let make = |slug: &str| {
        let id = account_id("claude", slug);
        let vault = root.join("claude").join(slug);
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::write(vault.join(OWNERSHIP_MARKER), format!("{id}\n")).unwrap();
        StoredAccount {
            id,
            agent_id: "claude".to_string(),
            label: slug.to_string(),
            email: None,
            plan: None,
            home_dir: vault.to_string_lossy().into_owned(),
            created_at: 0,
            active: false,
        }
    };
    (runtime, make("personal"), make("work"))
}

#[cfg(unix)]
#[test]
fn activation_captures_the_outgoing_account_before_overwriting_it() {
    let root = tempfile::tempdir().unwrap();
    let (runtime, mut personal, work) = claude_fixture(root.path());
    let mut capture = crate::daemon::credential_capture::CredentialCapture::default();
    personal.active = true;

    // Both accounts were imported at some point.
    runtime
        .write_managed_credentials(&personal.id, r#"{"accessToken":"personal-v1"}"#)
        .unwrap();
    runtime
        .write_managed_credentials(&work.id, r#"{"accessToken":"work-v1"}"#)
        .unwrap();
    runtime
        .write_live_credentials(r#"{"accessToken":"personal-v1"}"#)
        .unwrap();

    // The live CLI refreshes and rotates its token: the stored copy for
    // `personal` is now stale, and it is the only thing that can log that
    // account back in.
    runtime
        .write_live_credentials(r#"{"accessToken":"personal-v2"}"#)
        .unwrap();

    activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone()],
        Some(&personal),
        &work,
    )
    .unwrap();

    // The rotated token was captured, not thrown away…
    assert_eq!(
        runtime.read_managed_credentials(&personal.id).unwrap(),
        Some(r#"{"accessToken":"personal-v2"}"#.to_string())
    );
    // …and the CLI now runs as the target account.
    assert_eq!(
        runtime.read_live_credentials().unwrap(),
        Some(r#"{"accessToken":"work-v1"}"#.to_string())
    );

    // Switching back restores the captured token, not the stale one.
    activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone()],
        Some(&work),
        &personal,
    )
    .unwrap();
    assert_eq!(
        runtime.read_live_credentials().unwrap(),
        Some(r#"{"accessToken":"personal-v2"}"#.to_string())
    );
}

#[cfg(unix)]
#[test]
fn activation_moves_identity_and_credentials_together() {
    let root = tempfile::tempdir().unwrap();
    let (runtime, personal, work) = claude_fixture(root.path());
    let mut capture = crate::daemon::credential_capture::CredentialCapture::default();
    for (account, email) in [(&personal, "me@example.com"), (&work, "me@corp.com")] {
        runtime
            .write_managed_credentials(&account.id, r#"{"accessToken":"t"}"#)
            .unwrap();
        write_vault_file(
            Path::new(&account.home_dir),
            crate::daemon::claude_auth::OAUTH_ACCOUNT_FILE,
            &format!("{{\"emailAddress\":\"{email}\"}}"),
        )
        .unwrap();
    }
    std::fs::create_dir_all(&runtime.config_dir).unwrap();
    std::fs::write(
        &runtime.config_path,
        r#"{"oauthAccount":{"emailAddress":"me@corp.com"}}"#,
    )
    .unwrap();

    activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone()],
        Some(&work),
        &personal,
    )
    .unwrap();

    // Leaving the config on the previous account is what produced
    // "OAuth session expired and could not be refreshed" in the field: the
    // CLI had one account's token and another account's identity.
    assert_eq!(
        runtime.read_live_oauth_account().unwrap()["emailAddress"],
        "me@example.com"
    );
}

#[test]
fn a_whole_claude_json_stored_by_an_older_build_is_unwrapped() {
    let stored = serde_json::json!({
        "oauthAccount": { "emailAddress": "me@example.com" },
        "projects": { "/a": { "history": [1, 2] } },
    });
    // Written back verbatim, this would bury the entire config — history and
    // all — inside `oauthAccount`.
    assert_eq!(
        stored_oauth_account(stored)["emailAddress"],
        "me@example.com"
    );
    // A bare block (what current imports store) passes through untouched.
    let bare = serde_json::json!({ "emailAddress": "me@example.com" });
    assert_eq!(stored_oauth_account(bare.clone()), bare);
}

#[cfg(unix)]
#[test]
fn write_back_is_skipped_when_the_live_login_is_a_different_account() {
    let root = tempfile::tempdir().unwrap();
    let (runtime, mut personal, work) = claude_fixture(root.path());
    let mut capture = crate::daemon::credential_capture::CredentialCapture::default();
    personal.email = Some("personal@example.com".into());
    personal.active = true;
    runtime
        .write_managed_credentials(&personal.id, r#"{"accessToken":"personal-v1"}"#)
        .unwrap();
    runtime
        .write_managed_credentials(&work.id, r#"{"accessToken":"work-v1"}"#)
        .unwrap();

    // The user signed in as somebody else from a terminal since the last
    // switch, so the live credentials are not `personal`'s.
    std::fs::create_dir_all(&runtime.config_dir).unwrap();
    std::fs::write(
        runtime.config_dir.join(".claude.json"),
        r#"{"oauthAccount":{"emailAddress":"stranger@example.com"}}"#,
    )
    .unwrap();
    runtime
        .write_live_credentials(r#"{"accessToken":"stranger-token"}"#)
        .unwrap();

    let err = activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone()],
        Some(&personal),
        &work,
    )
    .unwrap_err();
    assert!(err.to_string().contains("stranger@example.com"), "{err}");

    // `personal` keeps its own credentials instead of adopting the
    // stranger's session under its label…
    assert_eq!(
        runtime.read_managed_credentials(&personal.id).unwrap(),
        Some(r#"{"accessToken":"personal-v1"}"#.to_string())
    );
    // …and the stranger's login, which nothing else holds a copy of, is not
    // overwritten by the switch.
    assert_eq!(
        runtime.read_live_credentials().unwrap().as_deref(),
        Some(r#"{"accessToken":"stranger-token"}"#)
    );

    // Once that login is saved as an account of its own, the switch goes ahead.
    let stranger = StoredAccount {
        agent_id: "claude".to_string(),
        email: Some("stranger@example.com".into()),
        ..account("claude:stranger", root.path())
    };
    activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone(), stranger],
        Some(&personal),
        &work,
    )
    .unwrap();
    assert_eq!(
        runtime.read_live_credentials().unwrap().as_deref(),
        Some(r#"{"accessToken":"work-v1"}"#)
    );
}

#[cfg(unix)]
#[test]
fn activation_discards_an_empty_read_back_and_refuses_a_broken_target() {
    let root = tempfile::tempdir().unwrap();
    let (runtime, personal, work) = claude_fixture(root.path());
    let mut capture = crate::daemon::credential_capture::CredentialCapture::default();
    runtime
        .write_managed_credentials(&personal.id, r#"{"accessToken":"personal-v1"}"#)
        .unwrap();
    runtime
        .write_managed_credentials(&work.id, r#"{"accessToken":"work-v1"}"#)
        .unwrap();

    // A live CLI that lost a refresh race wrote an empty blob. Persisting it
    // would log `personal` out permanently.
    runtime
        .write_live_credentials(r#"{"accessToken":""}"#)
        .unwrap();
    activate_claude_account_under(
        root.path(),
        &mut capture,
        &runtime,
        &[personal.clone(), work.clone()],
        Some(&personal),
        &work,
    )
    .unwrap();
    assert_eq!(
        runtime.read_managed_credentials(&personal.id).unwrap(),
        Some(r#"{"accessToken":"personal-v1"}"#.to_string()),
        "an unusable read-back must not overwrite a good stored token"
    );

    // A target with nothing stored fails loudly instead of leaving the CLI
    // authenticated as the previous account while the UI claims otherwise.
    let (runtime2, _, unknown) = claude_fixture(root.path());
    runtime2.delete_managed_credentials(&unknown.id).unwrap();
    std::fs::remove_file(
        Path::new(&unknown.home_dir).join(crate::daemon::claude_auth::CREDENTIALS_FILE),
    )
    .ok();
    let err =
        activate_claude_account_under(root.path(), &mut capture, &runtime2, &[], None, &unknown)
            .unwrap_err();
    assert!(err.to_string().contains("re-import"), "{err}");
}
