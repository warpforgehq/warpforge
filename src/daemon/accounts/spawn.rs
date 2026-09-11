use std::path::Path;

use crate::daemon::store::StoredAccount;

use super::vault::{accounts_root, verify_vault_under};

/// Environment changes an agent process needs: variables to set, and variables
/// that must be *removed* from what the daemon would otherwise pass down.
///
/// Removal is not a detail. An `ANTHROPIC_API_KEY` inherited by the daemon makes
/// the Claude CLI authenticate as something else entirely, so every account
/// switch appears to do nothing — with no error anywhere to explain it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentEnv {
    pub set: std::collections::HashMap<String, String>,
    pub remove: Vec<String>,
}

impl AgentEnv {
    pub fn is_empty(&self) -> bool {
        self.set.is_empty() && self.remove.is_empty()
    }
}

/// Which account a spawn runs under.
///
/// A session lives in the home it was created in — Codex indexes its threads in
/// a database under `CODEX_HOME`, so resuming one anywhere else finds nothing
/// and hangs. The account therefore belongs to the session, not to the moment
/// of resuming.
#[derive(Debug, Clone, Copy)]
pub enum SpawnAccount<'a> {
    /// The account this session was recorded against.
    Pinned(&'a str),
    /// The agent's own home. Every session started before accounts existed is
    /// here, which is why a task with a session but no recorded account resolves
    /// to this rather than to whatever happens to be active now.
    SharedHome,
    /// No session yet: whatever is active when it starts.
    Active,
}

/// Resolve a `SpawnAccount` to a stored account.
///
/// An account only ever applies to the agent it belongs to, pin included. A
/// task pinned to `claude:personal` but spawning Codex resolves to nothing, not
/// to the Claude account and not to whichever Codex account happens to be
/// active: `env_for` would otherwise hand Codex a Claude vault as its
/// `CODEX_HOME`, where it finds no `auth.json` and writes its own state.
///
/// A vault that no longer verifies — deleted, or replaced by a symlink — is
/// dropped rather than handed to a child process. The agent then falls back to
/// its own home, which is wrong-but-working; pointing it at a directory we
/// cannot vouch for is neither.
pub fn select_for_spawn<'a>(
    accounts: &'a [StoredAccount],
    agent_id: &str,
    choice: SpawnAccount<'_>,
) -> Option<&'a StoredAccount> {
    select_for_spawn_under(&accounts_root(), accounts, agent_id, choice)
}

/// `select_for_spawn` against an explicit root, so the vault check can be
/// exercised without writing into the real home directory.
pub(crate) fn select_for_spawn_under<'a>(
    root: &Path,
    accounts: &'a [StoredAccount],
    agent_id: &str,
    choice: SpawnAccount<'_>,
) -> Option<&'a StoredAccount> {
    match choice {
        SpawnAccount::Pinned(id) => accounts
            .iter()
            .find(|a| a.id == id && a.agent_id == agent_id),
        SpawnAccount::SharedHome => None,
        SpawnAccount::Active => accounts.iter().find(|a| a.agent_id == agent_id && a.active),
    }
    .filter(|account| verify_vault_under(root, Path::new(&account.home_dir), &account.id).is_ok())
}

/// Environment for an agent, given the selected account (if any).
///
/// Codex selects its account by `CODEX_HOME`. Claude does not — its account is
/// swapped in place — so it contributes only the strip list.
pub fn env_for(agent_id: &str, account: Option<&StoredAccount>) -> AgentEnv {
    let mut env = AgentEnv::default();
    match agent_id {
        "codex" => {
            if let Some(account) = account {
                env.set
                    .insert("CODEX_HOME".to_string(), account.home_dir.clone());
            }
        }
        "claude" => {
            env.remove = super::super::claude_auth::CONFLICTING_AUTH_ENV
                .iter()
                .map(|v| v.to_string())
                .collect();
            if std::env::var("ANTHROPIC_CUSTOM_HEADERS")
                .is_ok_and(|value| super::super::claude_auth::headers_look_like_auth(&value))
            {
                env.remove.push("ANTHROPIC_CUSTOM_HEADERS".to_string());
            }
        }
        _ => {}
    }
    env
}
