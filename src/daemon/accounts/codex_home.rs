use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use super::identity::{claude_identity, codex_identity, AccountIdentity};
use super::vault::write_vault_file;

/// Entries that make an account *be* that account, so each vault keeps its own
/// real file: the credentials, and the model list (which depends on the plan).
const CODEX_PRIVATE_ENTRIES: &[&str] = &["auth.json", "models_cache.json"];

/// Per-runtime state that must stay real inside the vault.
///
/// Codex opens SQLite databases directly under `CODEX_HOME`. Linking those at
/// the shared home puts one database behind two paths — with the `-wal`/`-shm`
/// pair split across them — and Codex refuses to start at all:
///
/// ```text
/// Error: failed to initialize sqlite state runtime under <CODEX_HOME>
/// ```
///
/// Lock directories, the IPC socket dir and scratch space are per-run for the
/// same reason. Logs and memories are here because they are noise, not state.
const CODEX_LOCAL_ENTRIES: &[&str] = &[
    "log",
    "memories",
    "tmp",
    ".tmp",
    "ipc",
    "sqlite",
    "thread-writer-locks",
    "mcp-oauth-locks",
    "process_manager",
];

/// Whether an entry stays local to the vault. Database names carry a serial
/// (`state_5.sqlite`, `logs_2.sqlite-wal`) that changes with Codex versions, so
/// they are matched by extension rather than listed.
fn is_codex_local_entry(name: &str) -> bool {
    CODEX_LOCAL_ENTRIES.contains(&name) || name.contains(".sqlite")
}

/// Give a Codex account home everything that is not account-specific by
/// symlinking it out of the shared `~/.codex`.
///
/// Without this a vault is an empty Codex home: no `config.toml`, no MCP
/// servers, and — most visibly — no `sessions/`, so every existing conversation
/// disappears the moment an account becomes active. Only links inside the vault
/// are created; the shared home is never written to, except to adopt sessions a
/// half-configured vault already collected (see `link_shared_entry`).
///
/// Idempotent: re-run on every activation, since the shared home grows entries
/// over time.
pub fn materialize_codex_home(shared: &Path, vault: &Path) -> Result<()> {
    let entries = std::fs::read_dir(shared)
        .with_context(|| format!("reading {}", shared.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name());
    for name in entries {
        let Some(name) = name.to_str() else { continue };
        if CODEX_PRIVATE_ENTRIES.contains(&name) || is_codex_local_entry(name) {
            continue;
        }
        link_shared_entry(shared, vault, name)?;
    }
    unlink_wrongly_shared(vault)?;
    Ok(())
}

/// Drop links a previous build created for entries that must be the vault's
/// own: a shared `auth.json` would silently merge two logins into one, and a
/// shared database stops Codex from starting. Only links are removed — a real
/// file is the vault's own state and is left alone.
fn unlink_wrongly_shared(vault: &Path) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(vault) else {
        return Ok(());
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !CODEX_PRIVATE_ENTRIES.contains(&name) && !is_codex_local_entry(name) {
            continue;
        }
        let path = entry.path();
        if std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            std::fs::remove_file(&path)
                .with_context(|| format!("removing shared {name} from vault"))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn link_shared_entry(shared: &Path, vault: &Path, name: &str) -> Result<()> {
    let target = shared.join(name);
    let link = vault.join(name);
    match std::fs::symlink_metadata(&link) {
        // Already ours and pointing at the right place.
        Ok(meta) if meta.file_type().is_symlink() => {
            if std::fs::read_link(&link).is_ok_and(|current| current == target) {
                return Ok(());
            }
            std::fs::remove_file(&link)?;
        }
        // A real directory here means the vault ran as an unmaterialized home
        // and collected state of its own. Move that state into the shared home
        // rather than stranding it, then link — otherwise those sessions are
        // invisible from everywhere else forever.
        Ok(meta) if meta.is_dir() => {
            if !adopt_directory(&link, &target)? {
                return Ok(());
            }
        }
        // A real file we cannot merge: leave it alone rather than lose it.
        Ok(_) => return Ok(()),
        Err(_) => {}
    }
    std::os::unix::fs::symlink(&target, &link)
        .with_context(|| format!("linking {} to {}", link.display(), target.display()))
}

#[cfg(not(unix))]
fn link_shared_entry(_shared: &Path, _vault: &Path, _name: &str) -> Result<()> {
    Ok(())
}

/// Move a vault directory's contents into the shared home and remove it.
/// Returns false when something could not be moved, leaving the directory (and
/// the caller's link) alone — never silently discards a file.
fn adopt_directory(local: &Path, shared: &Path) -> Result<bool> {
    std::fs::create_dir_all(shared)?;
    let mut moved_everything = true;
    for entry in std::fs::read_dir(local)? {
        let entry = entry?;
        let destination = shared.join(entry.file_name());
        // Directories that exist on both sides are merged, not skipped: session
        // history is partitioned by date, so the common case is both homes
        // holding a `2026/` and only the leaf files differing.
        if entry.file_type()?.is_dir() {
            if !adopt_directory(&entry.path(), &destination)? {
                moved_everything = false;
            }
        } else if destination.exists() {
            // Same file name on both sides: keep the shared copy, keep ours too.
            moved_everything = false;
        } else if std::fs::rename(entry.path(), &destination).is_err() {
            moved_everything = false;
        }
    }
    if moved_everything {
        std::fs::remove_dir_all(local)?;
    }
    Ok(moved_everything)
}

/// Home directory the agent itself uses — the read-only source an import copies
/// from. Never written to.
pub fn agent_home(agent_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match agent_id {
        "codex" => Some(home.join(".codex")),
        "claude" => Some(home.join(".claude")),
        _ => None,
    }
}

/// Copy the agent's currently-authenticated login into a vault and return the
/// identity read from it.
///
/// Codex keeps its whole session in `auth.json`, so the import is a file copy.
/// Claude's credentials come from wherever the CLI actually keeps them (login
/// keychain first, file second) via `runtime`, and are stored both in the vault
/// and in our own keychain service.
pub fn import_agent_login(
    agent_id: &str,
    vault: &Path,
    account_id: &str,
    runtime: &super::super::claude_auth::ClaudeRuntime,
) -> Result<AccountIdentity> {
    let Some(home) = agent_home(agent_id) else {
        bail!("agent '{agent_id}' has no known account storage");
    };
    match agent_id {
        "codex" => {
            let auth = std::fs::read_to_string(home.join("auth.json")).with_context(|| {
                format!(
                    "no Codex credentials in {} — run `codex login` first",
                    home.display()
                )
            })?;
            write_vault_file(vault, "auth.json", &auth)?;
            // The model list depends on the account's plan, so it must not be
            // shared between accounts.
            if let Ok(models) = std::fs::read_to_string(home.join("models_cache.json")) {
                write_vault_file(vault, "models_cache.json", &models)?;
            }
            materialize_codex_home(&home, vault)?;
            Ok(codex_identity(&auth))
        }
        "claude" => {
            let Some(credentials) = runtime.read_live_credentials()? else {
                bail!("no Claude login found — run `claude` and sign in first");
            };
            if !super::super::claude_auth::credentials_are_usable(&credentials) {
                bail!("the current Claude login has no usable token — sign in again first");
            }
            // Keychain is the durable copy on macOS; the vault file is the
            // fallback for platforms without one.
            runtime.write_managed_credentials(account_id, &credentials)?;
            write_vault_file(
                vault,
                super::super::claude_auth::CREDENTIALS_FILE,
                &credentials,
            )?;
            // Store only the `oauthAccount` block. The rest of `.claude.json`
            // is that machine's whole project history — tens of thousands of
            // lines that belong to no account in particular.
            let Some(oauth_account) = runtime.read_live_oauth_account() else {
                bail!("no Claude login found — run `claude` and sign in first");
            };
            write_vault_file(
                vault,
                super::super::claude_auth::OAUTH_ACCOUNT_FILE,
                &serde_json::to_string(&oauth_account)?,
            )?;
            Ok(claude_identity(&oauth_account.to_string()))
        }
        _ => bail!("agent '{agent_id}' does not support accounts"),
    }
}
