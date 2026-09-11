use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

use crate::daemon::store::StoredAccount;

use super::vault::{accounts_root, read_vault_file, verify_vault_under};

/// Claude keeps its account block in `~/.claude.json` by default, and in
/// `<config dir>/.claude.json` when `CLAUDE_CONFIG_DIR` is set. Try both.
fn claude_config_json(home: &Path) -> Result<String> {
    let colocated = home.join(".claude.json");
    if colocated.is_file() {
        return Ok(std::fs::read_to_string(&colocated)?);
    }
    let sibling = home
        .parent()
        .map(|p| p.join(".claude.json"))
        .unwrap_or_else(|| PathBuf::from(".claude.json"));
    Ok(std::fs::read_to_string(&sibling)?)
}

/// Make `target` the account the Claude CLI uses, capturing whatever the
/// outgoing account's credentials became first.
///
/// The order matters and is the whole point of the function. A live CLI rotates
/// its refresh token; the vault copy of the *outgoing* account is stale from
/// that moment. Overwriting the live credentials without reading them back
/// discards the only valid token that account has, and it is silently logged
/// out. So: read live → store under the outgoing account → write the target.
///
/// The read-back itself lives in `credential_capture`: a switch is only one of
/// the moments a rotation has to be caught, and all of them must apply the same
/// rules about what may be written into a vault.
pub fn activate_claude_account(
    capture: &mut super::super::credential_capture::CredentialCapture,
    runtime: &super::super::claude_auth::ClaudeRuntime,
    outgoing: Option<&StoredAccount>,
    target: &StoredAccount,
) -> Result<()> {
    activate_claude_account_under(&accounts_root(), capture, runtime, outgoing, target)
}

/// The `oauthAccount` block out of a stored identity file.
///
/// Accounts imported before this file held only the block store the whole
/// `.claude.json` instead. Writing that back verbatim would nest an entire
/// config (including every project's history) under `oauthAccount`, so unwrap
/// it when present rather than requiring a re-import.
pub(crate) fn stored_oauth_account(stored: serde_json::Value) -> serde_json::Value {
    stored
        .get("oauthAccount")
        .cloned()
        .unwrap_or_else(|| stored.clone())
}

pub(crate) fn activate_claude_account_under(
    root: &Path,
    capture: &mut super::super::credential_capture::CredentialCapture,
    runtime: &super::super::claude_auth::ClaudeRuntime,
    outgoing: Option<&StoredAccount>,
    target: &StoredAccount,
) -> Result<()> {
    if let Some(outgoing) = outgoing.filter(|outgoing| outgoing.id != target.id) {
        capture.capture_claude_under(
            root,
            runtime,
            std::slice::from_ref(outgoing),
            Some(outgoing),
        );
    }

    let vault = verify_vault_under(root, Path::new(&target.home_dir), &target.id)?;
    // Keychain first: on macOS it is what the CLI actually reads, so it is the
    // fresher copy whenever a previous switch wrote both.
    let credentials = match runtime.read_managed_credentials(&target.id)? {
        Some(credentials) => credentials,
        None => read_vault_file(&vault, super::super::claude_auth::CREDENTIALS_FILE)?.ok_or_else(
            || {
                anyhow::anyhow!(
                    "no stored credentials for '{}' — re-import that account",
                    target.label
                )
            },
        )?,
    };
    if !super::super::claude_auth::credentials_are_usable(&credentials) {
        bail!(
            "stored credentials for '{}' have no usable token — re-import that account",
            target.label
        );
    }
    // Identity before credentials. The CLI cross-checks the two: a token for one
    // account against a config naming another fails as "OAuth session expired",
    // and across organizations as "not a member of this organization".
    if let Some(oauth_account) =
        read_vault_file(&vault, super::super::claude_auth::OAUTH_ACCOUNT_FILE)?
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .map(stored_oauth_account)
    {
        runtime.write_live_oauth_account(&oauth_account)?;
    }
    runtime.write_live_credentials(&credentials)?;
    // Remember what we made live: without it the next capture sees credentials
    // it did not write, cannot tell our own switch from the CLI's rotation, and
    // has to fall back to the stricter rule that needs proof of freshness.
    capture.note_live_claude(&credentials);
    Ok(())
}
