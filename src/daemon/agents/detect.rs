//! Install-state detection: what is on PATH, what version it is, and whether a
//! newer one exists. Shells out (`which`, `--version`, `npm`) — callers run it
//! off the actor loop.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use warpforge_protocol as wire;

use super::manage::{can_reinstall, install_command, registry_is_baseline, update_command};
use super::KnownAgent;

/// Ceiling for a local probe (`which`, `<binary> --version`, `npm ls -g`).
/// Wide enough for a cold `npm`, short enough that detection still answers.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Ceiling for a registry lookup, kept short so a slow or absent npm registry
/// never delays detection.
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(4);

/// Run a detection probe and capture its output. None when the probe could not
/// be spawned or outran `limit`.
///
/// Both stdin settings are load-bearing. Tokio's `output()` pipes only
/// stdout/stderr (unlike std's), so a probe inherits the daemon's stdin — a
/// pipe the packaged desktop app holds open forever. A language server that
/// ignores `--version` and serves on stdio then blocks on that pipe forever.
/// `kill_on_drop` makes the deadline real: without it a timed-out probe keeps
/// running after we stop waiting.
pub(crate) async fn probe(
    program: &str,
    args: &[&str],
    limit: Duration,
) -> Option<std::process::Output> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    tokio::time::timeout(limit, command.output())
        .await
        .ok()?
        .ok()
}

/// Resolve a binary on PATH → its real (symlink-resolved) path, or None if
/// absent. Resolving the symlink matters for install-manager classification:
/// an npm-global bin often lives at a brew prefix as a link into node_modules.
pub(crate) async fn which(binary: &str) -> Option<String> {
    let output = probe("which", &[binary], PROBE_TIMEOUT).await?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    // Canonicalize so a symlinked wrapper resolves to its real install path.
    let real = tokio::fs::canonicalize(&path)
        .await
        .ok()
        .and_then(|p| p.to_str().map(String::from));
    Some(real.unwrap_or(path))
}

/// Latest published version of an npm package, cached ~1h with a short timeout
/// so a slow/absent registry never blocks detection. Shells out to `npm view`
/// (npm is already required to install agents) — no HTTP client dependency.
pub(crate) async fn latest_npm_version(pkg: &str) -> Option<String> {
    const TTL: Duration = Duration::from_secs(60 * 60);
    // pkg → (fetched_at, latest_version_or_none)
    type VersionCache = HashMap<String, (Instant, Option<String>)>;
    static CACHE: Mutex<Option<VersionCache>> = Mutex::new(None);
    {
        let guard = CACHE.lock().unwrap();
        if let Some(map) = guard.as_ref() {
            if let Some((at, version)) = map.get(pkg) {
                if at.elapsed() < TTL {
                    return version.clone();
                }
            }
        }
    }
    let version = probe("npm", &["view", pkg, "version"], REGISTRY_TIMEOUT)
        .await
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|v| !v.is_empty());
    let mut guard = CACHE.lock().unwrap();
    guard
        .get_or_insert_with(HashMap::new)
        .insert(pkg.to_string(), (Instant::now(), version.clone()));
    version
}

/// Installed version of an agent: the npm/bun/pnpm global package version when
/// the binary is package-manager-managed, or the binary's `--version` output
/// otherwise. The npm lookup is only trusted for npm-managed install paths so a
/// stale/duplicate npm copy can't shadow the version of the binary on PATH.
async fn installed_version(agent: &KnownAgent, resolved_path: Option<&str>) -> Option<String> {
    let manager = resolved_path.map(package_manager_for_path);
    if matches!(
        manager,
        Some(PackageManager::Npm | PackageManager::Bun | PackageManager::Pnpm)
    ) {
        if let Some(pkg) = agent.npm_package {
            if let Some(v) = npm_global_version(pkg).await {
                return Some(v);
            }
        }
    }
    // Fallback: `<binary> --version`, take the first version-looking token.
    let output = probe(agent.binary, &["--version"], PROBE_TIMEOUT).await?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    first_version_token(&text)
}

pub(crate) async fn npm_global_version(pkg: &str) -> Option<String> {
    let output = probe(
        "npm",
        &["ls", "-g", pkg, "--json", "--depth=0"],
        PROBE_TIMEOUT,
    )
    .await?;
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    json.get("dependencies")?
        .get(pkg)?
        .get("version")?
        .as_str()
        .map(String::from)
}

pub(crate) fn first_version_token(text: &str) -> Option<String> {
    // Scan for first substring matching semver-like \d+\.\d+\.\d+ (with optional
    // trailing .digits and -/+ prerelease). Handles polluted output where
    // elixir-ls --version emits LSP framing: `v0.31.1","type":3}}Content-Length:`.
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i < n {
        // allow optional leading 'v'
        let start = if bytes[i] == b'v' || bytes[i] == b'V' {
            if i + 1 < n && bytes[i + 1].is_ascii_digit() {
                i + 1
            } else {
                i += 1;
                continue;
            }
        } else if bytes[i].is_ascii_digit() {
            i
        } else {
            i += 1;
            continue;
        };
        // parse \d+(\.\d+){2,}
        let mut j = start;
        let mut dots = 0;
        while j < n {
            if bytes[j].is_ascii_digit() {
                j += 1;
            } else if bytes[j] == b'.' && j + 1 < n && bytes[j + 1].is_ascii_digit() {
                dots += 1;
                j += 1; // consume '.'
            } else {
                break;
            }
        }
        if dots >= 2 {
            // include optional prerelease/build suffix like -rc1 / +build
            while j < n && (bytes[j] == b'-' || bytes[j] == b'+') {
                let k = j + 1;
                let mut end = k;
                while end < n
                    && (bytes[end].is_ascii_alphanumeric()
                        || bytes[end] == b'.'
                        || bytes[end] == b'-')
                {
                    end += 1;
                }
                if end == k {
                    break;
                }
                j = end;
            }
            return Some(text[start..j].to_string());
        }
        i = j.max(i + 1);
    }
    None
}

/// -1 / 0 / 1 comparison of dotted numeric versions, ignoring any pre-release
/// suffix. Enough to answer "is current behind latest?".
pub(crate) fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(v: &str) -> Vec<u64> {
        v.split(['-', '+'])
            .next()
            .unwrap_or(v)
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    }
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PackageManager {
    Npm,
    Bun,
    Pnpm,
    Homebrew,
    Unknown,
}

/// Classify a global-install manager from the resolved binary path.
pub(crate) fn package_manager_for_path(path: &str) -> PackageManager {
    let p = path.replace('\\', "/").to_lowercase();
    // A brew formula always lives under Cellar/Caskroom and is unambiguous —
    // check it before the node paths below, because a brew-packaged Node app
    // (e.g. gemini-cli) also contains a `node_modules` internally and would
    // otherwise be misclassified as npm.
    if p.contains("/cellar/") || p.contains("/caskroom/") {
        return PackageManager::Homebrew;
    }
    // Check npm/bun/pnpm node paths: an npm-global binary installed under a
    // brew-managed Node lives at /opt/homebrew/bin/… (a symlink into
    // …/lib/node_modules/…) and must resolve to npm, not brew. These paths do
    // not contain /cellar, so they only run after the brew check above.
    if p.contains("/.bun/bin/") {
        PackageManager::Bun
    } else if p.contains("/pnpm/")
        || p.contains("/.local/share/pnpm/")
        || p.contains("/library/pnpm/")
    {
        PackageManager::Pnpm
    } else if p.contains("/node_modules/") || p.contains("/lib/node/") || p.contains("/npm/") {
        PackageManager::Npm
    } else {
        PackageManager::Unknown
    }
}

async fn detect_one(agent: &'static KnownAgent, check_latest: bool) -> wire::DetectedAgent {
    let path = which(agent.binary).await;
    let installed = path.is_some();

    if !installed {
        let install = install_command(agent);
        return wire::DetectedAgent {
            id: agent.id.to_string(),
            display_name: agent.display_name.to_string(),
            installed: false,
            default_acp_command: agent.default_acp_command.to_string(),
            install_hint: agent.install_hint.to_string(),
            version: None,
            latest_version: None,
            status: "missing".to_string(),
            can_manage: install.is_some(),
            can_reinstall: can_reinstall(None, agent.npm_package),
            install_command: install,
            update_command: None,
            // Filled in by the caller from the daemon's live health tracking;
            // detection itself has no opinion on whether the agent starts.
            broken_install: None,
        };
    }

    let version = installed_version(agent, path.as_deref()).await;
    let update = update_command(agent, path.as_deref());
    let latest = if check_latest && agent.id == "antigravity" {
        super::antigravity::latest_version().await
    } else if check_latest && registry_is_baseline(update.as_deref()) {
        match agent.npm_package {
            Some(pkg) => latest_npm_version(pkg).await,
            None => None,
        }
    } else {
        None
    };

    let below_minimum = agent.id == "antigravity"
        && version
            .as_deref()
            .is_some_and(super::antigravity::below_minimum);
    let status = if below_minimum {
        "behind"
    } else {
        match (&version, &latest) {
            (Some(v), Some(l)) => {
                if compare_versions(v, l) == std::cmp::Ordering::Less {
                    "behind"
                } else {
                    "current"
                }
            }
            _ => "unknown",
        }
    }
    .to_string();

    wire::DetectedAgent {
        id: agent.id.to_string(),
        display_name: agent.display_name.to_string(),
        installed: true,
        default_acp_command: agent.default_acp_command.to_string(),
        install_hint: agent.install_hint.to_string(),
        version,
        latest_version: latest,
        status,
        can_manage: update.is_some(),
        can_reinstall: can_reinstall(
            path.as_deref().map(package_manager_for_path),
            agent.npm_package,
        ),
        update_command: update,
        install_command: None,
        // Filled in by the caller from the daemon's live health tracking;
        // detection itself has no opinion on whether the agent starts.
        broken_install: None,
    }
}

/// Detect every known agent concurrently, including registry freshness checks.
/// Runs outside the actor so the network calls don't block command handling.
pub async fn detect_agents() -> Vec<wire::DetectedAgent> {
    let futures = super::KNOWN_AGENTS.iter().map(|a| detect_one(a, true));
    futures::future::join_all(futures).await
}

/// Fast local-only detection (no registry lookups) for the first-run setup
/// prompt, where we only need to know what is installed.
pub async fn detect_agents_local() -> Vec<wire::DetectedAgent> {
    let futures = super::KNOWN_AGENTS.iter().map(|a| detect_one(a, false));
    futures::future::join_all(futures).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A probe that never exits must not hold its caller open: one unbounded
    /// `--version` left the whole `lsp.detect` request unanswered.
    #[cfg(unix)]
    #[tokio::test]
    async fn probe_gives_up_on_a_command_that_outruns_its_deadline() {
        let started = std::time::Instant::now();
        assert!(probe("sleep", &["30"], Duration::from_millis(200))
            .await
            .is_none());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    /// A probe's stdin must be closed, not inherited: the packaged daemon's
    /// stdin is a pipe that never sees EOF. `cat` exits only at EOF.
    #[cfg(unix)]
    #[tokio::test]
    async fn probe_closes_stdin_so_a_reader_sees_eof() {
        let output = probe("cat", &[], Duration::from_secs(5)).await.unwrap();
        assert!(output.status.success());
        assert!(output.stdout.is_empty());
    }

    #[test]
    fn package_manager_prefers_brew_over_inner_node_modules() {
        // A brew formula that packages a Node app (e.g. gemini-cli) lives under
        // Cellar but also contains node_modules internally. It must classify as
        // Homebrew, not Npm, or the daemon would wrongly `npm install -g` it.
        let gemini = "/opt/homebrew/Cellar/gemini-cli/0.36.0/libexec/lib/node_modules/@google/gemini-cli/bundle/gemini.js";
        assert_eq!(package_manager_for_path(gemini), PackageManager::Homebrew);
    }

    #[test]
    fn package_manager_classifies_npm_under_brew_node() {
        // npm-global install under a brew-managed Node has no /cellar segment.
        let npm = "/opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/cli.js";
        assert_eq!(package_manager_for_path(npm), PackageManager::Npm);
    }

    #[test]
    fn package_manager_classifies_bun_and_plain_cellar() {
        assert_eq!(
            package_manager_for_path("/home/u/.bun/bin/opencode"),
            PackageManager::Bun
        );
        assert_eq!(
            package_manager_for_path("/opt/homebrew/Cellar/goose/1.16.0/bin/goose"),
            PackageManager::Homebrew
        );
    }
}
