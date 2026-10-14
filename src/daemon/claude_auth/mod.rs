//! Claude account switching: which login the `claude` CLI uses right now.
//!
//! Claude is not switched by environment. Its config directory holds skills,
//! plugins, settings, MCP config and project history, so giving each account its
//! own `CLAUDE_CONFIG_DIR` would fragment all of that. Instead there is one
//! config dir and the *credentials inside it* are swapped. Which directory that
//! is the user decides once, in `claude_config`.
//!
//! Two consequences follow, and both are load-bearing:
//!
//! * **Switching is global.** The user's terminal `claude` follows it too. A
//!   running session also follows it, on its next request — the CLI re-reads
//!   credentials rather than holding them for its lifetime. That is the point
//!   (switch mid-task, keep working), not an accident.
//! * **The outgoing account must be captured before it is overwritten.** A live
//!   CLI refreshes and rotates its token; the copy in our vault goes stale the
//!   moment it does. Writing the incoming account over it without reading it
//!   back first throws away the only valid refresh token that account has, and
//!   the user is silently logged out of it — the failure mode that makes naive
//!   credential swapping feel random.
//!
//! On macOS the credentials live in the login keychain, not (only) on disk.
//! Claude Code 2.1+ scopes the keychain item by config dir —
//! `Claude Code-credentials-<first 8 hex of sha256(configDir)>` — while older
//! builds and the default config dir use the unsuffixed service. For the
//! default dir, reads try the scoped item first and fall back; writes update the
//! canonical item always and the scoped one only when it already exists. For a
//! dir the user chose (`scoped_only`), only the scoped item is this dir's: the
//! unsuffixed one is the default dir's login, and is never touched (see
//! `credentials`).

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

/// Keychain service Claude Code itself reads (pre-2.1, and still the fallback).
const ACTIVE_SERVICE: &str = "Claude Code-credentials";
/// Keychain service holding our per-account copies. Keyed by account id.
const MANAGED_SERVICE: &str = "Warpforge Claude Managed Credentials";
/// Credential file name inside a config dir (and inside our vaults).
pub const CREDENTIALS_FILE: &str = ".credentials.json";
/// Account metadata we store alongside it, for the switcher's label.
pub const OAUTH_ACCOUNT_FILE: &str = "oauth-account.json";

/// How to reach the keychain and the config dir. Injectable so the swap can be
/// tested without touching the real login keychain.
#[derive(Debug, Clone)]
pub struct ClaudeRuntime {
    /// Claude's config dir, as `claude_config::config_dir` resolves it.
    pub config_dir: PathBuf,
    /// The global config file the CLI actually reads; see [`cli_config_path`].
    pub config_path: PathBuf,
    /// `security` binary. `None` disables keychain access (non-macOS, tests).
    pub security_bin: Option<PathBuf>,
    /// Keychain account name — the login user.
    pub user: String,
    /// The CLI runs with `CLAUDE_CONFIG_DIR` set to `config_dir`, so it keeps
    /// its login in the scoped keychain item only. The unsuffixed item then
    /// belongs to the default `~/.claude` — someone else's login, which must be
    /// neither read as this dir's nor overwritten by a switch.
    pub scoped_only: bool,
}

impl ClaudeRuntime {
    pub fn detect() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let super::claude_config::ClaudeDir {
            path: config_dir,
            explicit,
        } = super::claude_config::config_dir();
        let config_path = cli_config_path(&config_dir, explicit, &home);
        Self {
            config_dir,
            config_path,
            security_bin: cfg!(target_os = "macos").then(|| PathBuf::from("/usr/bin/security")),
            user: std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "user".to_string()),
            scoped_only: explicit,
        }
    }

    /// The `oauthAccount` block the CLI currently believes it is signed in as.
    pub fn read_live_oauth_account(&self) -> Option<serde_json::Value> {
        let text = std::fs::read_to_string(&self.config_path).ok()?;
        let config: serde_json::Value = serde_json::from_str(&text).ok()?;
        config.get("oauthAccount").cloned()
    }

    /// Point the CLI's config at `account`, leaving the rest of `.claude.json`
    /// untouched.
    ///
    /// Swapping credentials without this is the bug it was written for: the CLI
    /// gets a token for one account while its config still names another, and
    /// reports "OAuth session expired and could not be refreshed" — or, across
    /// organizations, refuses the login as not a member. The file also holds
    /// every project's history, so it is edited in place, never rewritten.
    pub fn write_live_oauth_account(&self, account: &serde_json::Value) -> Result<()> {
        let mut config = match std::fs::read_to_string(&self.config_path) {
            Ok(text) => serde_json::from_str::<serde_json::Value>(&text)
                .with_context(|| format!("parsing {}", self.config_path.display()))?,
            Err(_) => serde_json::json!({}),
        };
        let Some(object) = config.as_object_mut() else {
            bail!("{} is not a JSON object", self.config_path.display());
        };
        object.insert("oauthAccount".to_string(), account.clone());
        let serialized = serde_json::to_string(&config)?;
        write_config_file(&self.config_path, &serialized)
    }
}

/// The global config file (`oauthAccount`, user MCP servers, project state)
/// the CLI reads for `config_dir`, by its own rule: a legacy
/// `<dir>/.config.json` if one exists, else `.claude.json` in the chosen dir
/// when it was set explicitly, else `~/.claude.json`.
///
/// A `~/.claude/.claude.json` lying around for the default dir is *not* it.
/// Preferring such a file because it exists — as this once did — reads the
/// identity from a file the CLI ignores, and a switch then writes
/// `oauthAccount` there: the CLI keeps one account's identity next to
/// another's token, which it reports as "OAuth session expired".
pub(crate) fn cli_config_path(config_dir: &Path, explicit: bool, home: &Path) -> PathBuf {
    let legacy = config_dir.join(".config.json");
    if legacy.is_file() {
        return legacy;
    }
    if explicit {
        config_dir.join(".claude.json")
    } else {
        home.join(".claude.json")
    }
}

/// Environment variables that override the selected account. Any of these set
/// in the daemon's environment makes the CLI authenticate as something else,
/// and the switch appears to do nothing at all — so they are removed from the
/// child rather than trusted to be absent.
pub const CONFLICTING_AUTH_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
];

/// Whether a custom-headers value smuggles credentials, in which case it is
/// stripped rather than passed through to a spawned agent.
pub fn headers_look_like_auth(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    ["authorization", "x-api-key", "api-key", "bearer"]
        .iter()
        .any(|needle| lowered.contains(needle))
}

/// A credentials blob is usable if it parses and carries a non-empty token.
///
/// This exists because a live CLI that loses a refresh race can write an empty
/// credentials blob. Persisting that into a vault would log the account out for
/// good, so an unusable read-back is discarded rather than stored.
pub fn credentials_are_usable(blob: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(blob) else {
        return false;
    };
    // Claude has nested the token under different keys across versions
    // (`accessToken`, `claudeAiOauth.refreshToken`, …), so look for any
    // non-empty `*token*` string anywhere in the blob rather than a fixed path.
    fn has_token(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(map) => map.iter().any(|(key, v)| {
                let named_token = key.to_ascii_lowercase().contains("token");
                match v {
                    serde_json::Value::String(s) => named_token && !s.trim().is_empty(),
                    nested => has_token(nested),
                }
            }),
            serde_json::Value::Array(items) => items.iter().any(has_token),
            _ => false,
        }
    }
    has_token(&value)
}

/// Replace a config file atomically, keeping its existing permissions — it is
/// not a secret, and `.claude.json` is world-readable by default.
fn write_config_file(path: &Path, contents: &str) -> Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).ok();
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("config")
    ));
    std::fs::write(&tmp, contents).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))
}

fn write_secret_file(path: &Path, contents: &str) -> Result<()> {
    // Write through a sibling temp file and rename, so a crash mid-write can
    // never leave the live credentials truncated.
    let dir = path.parent().unwrap_or(Path::new("."));
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("cred")
    ));
    std::fs::write(&tmp, contents).with_context(|| format!("writing {}", tmp.display()))?;
    set_owner_only(&tmp)?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))?;
    set_owner_only(path)
}

#[cfg(unix)]
fn set_owner_only(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("restricting permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path) -> Result<()> {
    Ok(())
}

mod credentials;

#[cfg(test)]
pub(crate) mod tests;
