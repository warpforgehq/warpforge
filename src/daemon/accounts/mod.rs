//! Agent accounts: several logins for the same agent, one active at a time.
//!
//! Each account owns a vault directory under `~/.warpforge/accounts/<agent>/`
//! holding whatever that agent needs to be that account — for Codex the whole
//! `CODEX_HOME`, for Claude just the credential blob. Two rules hold for both,
//! and both exist because the alternative silently destroys user data:
//!
//! * **Never write inside the agent's own home** (`~/.codex`, `~/.claude`).
//!   It is a read-only input; everything we create lives in our vault.
//! * **Every vault path is proven ours before use** — inside the accounts root,
//!   not a symlink, and carrying a marker file naming the account. A row in
//!   SQLite is not proof; a crafted `home_dir` would otherwise make the daemon
//!   read or overwrite arbitrary files.
//!
//! Credentials never leave this module: `AccountInfo` carries the label, email
//! and plan, never a token. See `plans/005-agent-account-hot-swap.md`.

mod claude;
mod codex_home;
mod identity;
mod spawn;
mod vault;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub use claude::activate_claude_account;
#[allow(unused_imports)]
pub use codex_home::{agent_home, import_agent_login, materialize_codex_home};
#[allow(unused_imports)]
pub use identity::{claude_identity, codex_identity, jwt_claims, AccountIdentity};
#[allow(unused_imports)]
pub use spawn::{env_for, select_for_spawn, AgentEnv, SpawnAccount};
#[allow(unused_imports)]
pub use vault::{
    account_id, accounts_root, create_vault, read_vault_file, remove_vault, slugify, vault_path,
    verify_vault, write_vault_file,
};

#[cfg(test)]
pub(crate) use claude::{activate_claude_account_under, stored_oauth_account};
#[cfg(test)]
pub(crate) use spawn::select_for_spawn_under;
pub(crate) use vault::verify_vault_under;
#[cfg(test)]
pub(crate) use vault::{create_vault_under, OWNERSHIP_MARKER};
