//! The GitHub credential. One resolver answers for every GitHub call the daemon
//! makes: a PAT from the environment or the keychain, else the token of the
//! `gh auth login` session. The answer is cached so the keychain and `gh` are
//! asked once per [`TOKEN_TTL`], not once per request.

use anyhow::{anyhow, bail, Context, Result};
use std::future::Future;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use super::KEYCHAIN_SERVICE;
use crate::daemon::tracker::NETWORK_TIMEOUT;

/// How long a resolved token is trusted before the sources are asked again. A
/// 401 drops it sooner, so a rotated token is picked up on the next call.
const TOKEN_TTL: Duration = Duration::from_secs(10 * 60);

/// How long "no credential anywhere" is remembered. Short, because the fix is
/// a `gh auth login` in another window; connecting from Settings clears it.
const MISSING_TTL: Duration = Duration::from_secs(30);

pub(super) const NO_CREDENTIALS: &str =
    "GitHub is not connected. Connect GitHub in Settings or run `gh auth login`.";

#[derive(Clone)]
struct Cached {
    token: Option<String>,
    at: Instant,
    login: Option<String>,
}

static CACHE: Mutex<Option<Cached>> = Mutex::const_new(None);

fn security_bin() -> Option<PathBuf> {
    cfg!(target_os = "macos").then(|| PathBuf::from("/usr/bin/security"))
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The first non-empty source, asked in order: `GH_TOKEN`, `GITHUB_TOKEN`, the
/// keychain PAT, the `gh` session. A later source is never polled once an
/// earlier one answered, so a PAT user never spawns `gh`.
pub(super) async fn resolve_token<K, G>(
    env: impl Fn(&str) -> Option<String>,
    keychain: K,
    gh: G,
) -> Option<String>
where
    K: Future<Output = Option<String>>,
    G: Future<Output = Option<String>>,
{
    if let Some(token) = non_empty(env("GH_TOKEN")).or_else(|| non_empty(env("GITHUB_TOKEN"))) {
        return Some(token);
    }
    if let Some(token) = non_empty(keychain.await) {
        return Some(token);
    }
    non_empty(gh.await)
}

/// The keychain PAT, read on a blocking thread: `security` is a subprocess.
async fn keychain_token() -> Option<String> {
    let bin = security_bin()?;
    tokio::task::spawn_blocking(move || {
        let out = std::process::Command::new(bin)
            .args([
                "find-generic-password",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                "github",
                "-w",
            ])
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .ok()
    .flatten()
}

/// The token of the `gh auth login` session, if `gh` is installed and signed in.
async fn gh_session_token() -> Option<String> {
    let mut cmd = tokio::process::Command::new("gh");
    cmd.args(["auth", "token", "--hostname", "github.com"])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(NETWORK_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn fresh(entry: &Cached) -> bool {
    let ttl = if entry.token.is_some() {
        TOKEN_TTL
    } else {
        MISSING_TTL
    };
    entry.at.elapsed() < ttl
}

/// The token every GitHub call uses, or `None` when neither a PAT nor a `gh`
/// session exists. The lock is held while resolving so a burst of calls on a
/// cold cache spawns `gh` once.
pub async fn github_token() -> Option<String> {
    let mut guard = CACHE.lock().await;
    if let Some(entry) = guard.as_ref().filter(|entry| fresh(entry)) {
        return entry.token.clone();
    }
    let token = resolve_token(
        |key| std::env::var(key).ok(),
        keychain_token(),
        gh_session_token(),
    )
    .await;
    *guard = Some(Cached {
        token: token.clone(),
        at: Instant::now(),
        login: None,
    });
    token
}

/// Forget `token` after GitHub rejected it. A different token cached since
/// (another caller already re-resolved) is left alone.
pub(super) async fn invalidate_token(token: &str) {
    let mut guard = CACHE.lock().await;
    if guard
        .as_ref()
        .is_some_and(|entry| entry.token.as_deref() == Some(token))
    {
        *guard = None;
    }
}

/// Forget whatever is cached: the user just connected or disconnected.
pub(crate) async fn forget_token() {
    *CACHE.lock().await = None;
}

/// The login the credential acts as. Asked once per cached token.
pub async fn github_login() -> Option<String> {
    let token = github_token().await?;
    if let Some(login) = CACHE
        .lock()
        .await
        .as_ref()
        .filter(|entry| entry.token.as_deref() == Some(token.as_str()))
        .and_then(|entry| entry.login.clone())
    {
        return Some(login);
    }
    let value = super::http::rest_json(reqwest::Method::GET, "user", None)
        .await
        .ok()?;
    let login = non_empty(
        value
            .get("login")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    )?;
    if let Some(entry) = CACHE
        .lock()
        .await
        .as_mut()
        .filter(|entry| entry.token.as_deref() == Some(token.as_str()))
    {
        entry.login = Some(login.clone());
    }
    Some(login)
}

pub(crate) fn github_keychain_write(secret: &str) -> Result<()> {
    let bin = security_bin().ok_or_else(|| anyhow!("keychain unavailable on this platform"))?;
    let out = std::process::Command::new(bin)
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            "github",
            "-w",
        ])
        .arg(secret)
        .output()
        .context("running security add-generic-password")?;
    if !out.status.success() {
        bail!(
            "keychain write failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

pub(crate) fn github_keychain_delete() -> Result<()> {
    if let Some(bin) = security_bin() {
        let _ = std::process::Command::new(bin)
            .args([
                "delete-generic-password",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                "github",
            ])
            .output();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    }

    #[tokio::test]
    async fn the_environment_wins_and_later_sources_are_never_asked() {
        let asked = AtomicUsize::new(0);
        let token = resolve_token(
            env_of(&[("GITHUB_TOKEN", "env-github"), ("GH_TOKEN", "env-gh")]),
            async {
                asked.fetch_add(1, Ordering::SeqCst);
                Some("keychain".to_string())
            },
            async {
                asked.fetch_add(1, Ordering::SeqCst);
                Some("gh".to_string())
            },
        )
        .await;
        assert_eq!(token.as_deref(), Some("env-gh"));
        assert_eq!(asked.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn the_keychain_pat_beats_the_gh_session() {
        let gh_asked = AtomicUsize::new(0);
        let token = resolve_token(
            env_of(&[("GH_TOKEN", "  ")]),
            async { Some("keychain\n".to_string()) },
            async {
                gh_asked.fetch_add(1, Ordering::SeqCst);
                Some("gh".to_string())
            },
        )
        .await;
        assert_eq!(token.as_deref(), Some("keychain"));
        assert_eq!(gh_asked.load(Ordering::SeqCst), 0, "gh must not be spawned");
    }

    #[tokio::test]
    async fn the_gh_session_answers_when_there_is_no_pat() {
        let token = resolve_token(env_of(&[]), async { None }, async {
            Some("gho_session".to_string())
        })
        .await;
        assert_eq!(token.as_deref(), Some("gho_session"));
        assert_eq!(
            resolve_token(env_of(&[]), async { None }, async { Some(String::new()) }).await,
            None
        );
    }

    #[tokio::test]
    async fn invalidating_drops_only_the_rejected_token() {
        *CACHE.lock().await = Some(Cached {
            token: Some("current".into()),
            at: Instant::now(),
            login: Some("octocat".into()),
        });
        invalidate_token("stale").await;
        assert!(CACHE.lock().await.is_some(), "another token must survive");
        invalidate_token("current").await;
        assert!(
            CACHE.lock().await.is_none(),
            "a 401'd token must be re-resolved"
        );
    }
}
