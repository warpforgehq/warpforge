//! The repository a checkout belongs to: `owner/repo` read from its `origin`
//! remote, including SSH host aliases that point at github.com.

use anyhow::{bail, Result};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Resolving `owner/repo` costs a `git` subprocess (and an `ssh -G` one for a
/// host alias), and every issue call opens with it. The remote of a checkout
/// effectively never changes, so a short-lived cache collapses a burst of
/// calls into one lookup.
const OWNER_REPO_TTL: Duration = Duration::from_secs(60);

/// Keyed by repo directory: when it was resolved, and the `owner`/`repo` it is.
type OwnerRepoCache = HashMap<String, (Instant, (String, String))>;

static OWNER_REPO_CACHE: Mutex<Option<OwnerRepoCache>> = Mutex::new(None);

/// Resolve `owner/repo` from the given git directory's origin remote.
pub(crate) async fn github_owner_repo(repo_dir: &str) -> Result<(String, String)> {
    if let Some(hit) = cached_owner_repo(repo_dir) {
        return Ok(hit);
    }
    let resolved = resolve_owner_repo(repo_dir).await?;
    // Only a success is cached: a failure is usually a setup problem the user is
    // about to fix, and re-asking after the fix should not wait out the TTL.
    if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
        guard
            .get_or_insert_with(OwnerRepoCache::new)
            .insert(repo_dir.to_string(), (Instant::now(), resolved.clone()));
    }
    Ok(resolved)
}

fn cached_owner_repo(repo_dir: &str) -> Option<(String, String)> {
    let mut guard = OWNER_REPO_CACHE.lock().ok()?;
    let cache = guard.as_mut()?;
    cache.retain(|_, (at, _)| at.elapsed() < OWNER_REPO_TTL);
    cache.get(repo_dir).map(|(_, name)| name.clone())
}

async fn resolve_owner_repo(repo_dir: &str) -> Result<(String, String)> {
    let out = tokio::process::Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .args(["remote", "get-url", "origin"])
        .kill_on_drop(true)
        .output()
        .await?;
    if !out.status.success() {
        bail!("this project has no `origin` remote, so it is not a GitHub repository");
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // The URL itself stays out of the error: an https remote can carry a token.
    match parse_github_remote(&url) {
        Some(Remote::GitHub(owner, repo)) => Ok((owner, repo)),
        Some(Remote::SshAlias { host, owner, repo }) => {
            if alias_is_github(&host).await {
                Ok((owner, repo))
            } else {
                bail!("`origin` points at {host}, which is not github.com")
            }
        }
        None => bail!("`origin` is not a github.com repository"),
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum Remote {
    GitHub(String, String),
    /// An SSH host that is not github.com by name but may be an alias for it
    /// in `~/.ssh/config` (`git@github-work:owner/repo`).
    SshAlias {
        host: String,
        owner: String,
        repo: String,
    },
}

fn is_github_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "github.com" | "www.github.com" | "ssh.github.com"
    )
}

/// Parse an `origin` URL: `https://[user@]github.com/o/r`, `ssh://`,
/// `git+ssh://`, `git://`, and the scp form `[user@]host:o/r`.
pub(super) fn parse_github_remote(url: &str) -> Option<Remote> {
    let url = url.trim();
    let (host, path, ssh) = if let Some((scheme, rest)) = url.split_once("://") {
        let ssh = matches!(scheme, "ssh" | "git+ssh" | "ssh+git");
        if !ssh && !matches!(scheme, "https" | "http" | "git") {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        let host = host.split(':').next()?;
        (host, path, ssh)
    } else {
        let (authority, path) = url.split_once(':')?;
        if authority.contains('/') {
            return None;
        }
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        (host, path, true)
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, repo) = path.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(owner) || !valid(repo) || host.is_empty() {
        return None;
    }
    if is_github_host(host) {
        Some(Remote::GitHub(owner.to_string(), repo.to_string()))
    } else if ssh {
        Some(Remote::SshAlias {
            host: host.to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
        })
    } else {
        None
    }
}

/// Whether an SSH host alias resolves to github.com. `ssh -G` only prints the
/// effective config; it never connects. Answers are kept for the daemon's
/// lifetime, since `~/.ssh/config` rarely changes under a running checkout.
async fn alias_is_github(host: &str) -> bool {
    static ALIASES: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);
    if let Some(hit) = ALIASES
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref()?.get(host).copied())
    {
        return hit;
    }
    if host.starts_with('-') {
        return false;
    }
    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args(["-G", host])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let resolved = tokio::time::timeout(Duration::from_secs(3), cmd.output())
        .await
        .ok()
        .and_then(|out| out.ok())
        .filter(|out| out.status.success())
        .is_some_and(|out| ssh_config_hostname_is_github(&String::from_utf8_lossy(&out.stdout)));
    if let Ok(mut guard) = ALIASES.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(host.to_string(), resolved);
    }
    resolved
}

fn ssh_config_hostname_is_github(config: &str) -> bool {
    config
        .lines()
        .find_map(|line| line.strip_prefix("hostname "))
        .is_some_and(|name| is_github_host(name.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gh(owner: &str, repo: &str) -> Option<Remote> {
        Some(Remote::GitHub(owner.into(), repo.into()))
    }

    #[test]
    fn every_spelling_of_a_github_remote_parses() {
        for url in [
            "git@github.com:acme/widgets.git",
            "github.com:acme/widgets",
            "https://github.com/acme/widgets",
            "https://github.com/acme/widgets.git/",
            "http://github.com/acme/widgets",
            "https://user@github.com/acme/widgets.git",
            "https://user:token@github.com/acme/widgets",
            "ssh://git@github.com/acme/widgets.git",
            "ssh://git@github.com:22/acme/widgets",
            "ssh://git@ssh.github.com:443/acme/widgets.git",
            "git+ssh://git@github.com/acme/widgets.git",
            "git://github.com/acme/widgets.git",
        ] {
            assert_eq!(parse_github_remote(url), gh("acme", "widgets"), "{url}");
        }
    }

    #[test]
    fn an_ssh_host_alias_is_resolved_rather_than_trusted() {
        let alias = |host: &str| {
            Some(Remote::SshAlias {
                host: host.into(),
                owner: "acme".into(),
                repo: "widgets".into(),
            })
        };
        assert_eq!(
            parse_github_remote("git@github-work:acme/widgets.git"),
            alias("github-work")
        );
        assert_eq!(
            parse_github_remote("ssh://git@work/acme/widgets"),
            alias("work")
        );
        assert!(ssh_config_hostname_is_github(
            "user git\nhostname github.com\nport 22\n"
        ));
        assert!(!ssh_config_hostname_is_github("hostname gitlab.com\n"));
    }

    #[test]
    fn other_hosts_and_shapes_are_not_github() {
        for url in [
            "https://gitlab.com/acme/widgets",
            "https://github.com/acme",
            "/srv/git/widgets.git",
            "file:///srv/git/widgets.git",
            "git@github.com:acme/wid gets",
        ] {
            assert_eq!(parse_github_remote(url), None, "{url}");
        }
    }

    #[test]
    fn the_owner_repo_cache_answers_until_the_ttl_passes() {
        let dir = "/tmp/warpforge-owner-repo-cache-test";
        if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
            guard.get_or_insert_with(OwnerRepoCache::new).insert(
                dir.to_string(),
                (Instant::now(), ("acme".into(), "widgets".into())),
            );
        }
        assert_eq!(
            cached_owner_repo(dir),
            Some(("acme".into(), "widgets".into()))
        );

        let Some(expired) = Instant::now().checked_sub(OWNER_REPO_TTL + Duration::from_secs(1))
        else {
            return;
        };
        if let Ok(mut guard) = OWNER_REPO_CACHE.lock() {
            guard.get_or_insert_with(OwnerRepoCache::new).insert(
                dir.to_string(),
                (expired, ("acme".into(), "widgets".into())),
            );
        }
        assert_eq!(
            cached_owner_repo(dir),
            None,
            "a stale entry must be dropped"
        );
    }
}
