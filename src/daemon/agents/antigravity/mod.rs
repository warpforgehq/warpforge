//! Google Antigravity's `agy` CLI: its release manifest, the minimum version
//! Warpforge speaks to, and the copy Warpforge installs and updates itself.

mod managed;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::detect::compare_versions;

pub(crate) use managed::{expose_managed_bin, install_script, is_managed, MANAGED_LABEL};

const MANIFEST_BASE: &str =
    "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";
const TIMEOUT: Duration = Duration::from_secs(4);
const TTL: Duration = Duration::from_secs(60 * 60);
const MIN_VERSION: &str = "1.5.0";

pub(super) fn below_minimum(version: &str) -> bool {
    compare_versions(version, MIN_VERSION).is_lt()
}

fn target(os: &str, arch: &str, musl: bool) -> Option<String> {
    let os = match os {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        _ => return None,
    };
    let cpu = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => return None,
    };
    let suffix = if os == "linux" && musl { "_musl" } else { "" };
    Some(format!("{os}_{cpu}{suffix}"))
}

#[derive(Deserialize)]
pub(crate) struct Manifest {
    pub version: String,
    pub url: String,
    pub sha512: String,
}

fn parse_manifest(value: &[u8], os: &str, arch: &str, musl: bool) -> Option<Manifest> {
    target(os, arch, musl)?;
    let mut manifest: Manifest = serde_json::from_slice(value).ok()?;
    let parts: Vec<_> = manifest.version.split('.').collect();
    if parts.len() != 3
        || !parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        || manifest.sha512.len() != 128
        || !manifest.sha512.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    manifest.sha512.make_ascii_lowercase();
    let (folder_os, file_os, extension) = match os {
        "macos" => ("darwin", "mac", "tar.gz"),
        "windows" => ("windows", "windows", "exe"),
        _ => ("linux", "linux", "tar.gz"),
    };
    let (folder_cpu, file_cpu) = if arch == "aarch64" {
        ("arm", "arm64")
    } else {
        ("x64", "x64")
    };
    let (folder_suffix, file_suffix) = if os == "linux" && musl {
        ("-musl", "_musl")
    } else {
        ("", "")
    };
    let prefix = format!(
        "https://storage.googleapis.com/antigravity-public/antigravity-cli/{}-",
        manifest.version
    );
    let rest = manifest.url.strip_prefix(&prefix)?;
    let (build, file) = rest.split_once('/')?;
    let expected = format!(
        "{folder_os}-{folder_cpu}{folder_suffix}/cli_{file_os}_{file_cpu}{file_suffix}.{extension}"
    );
    if build.is_empty() || !build.bytes().all(|b| b.is_ascii_digit()) || file != expected {
        return None;
    }
    Some(manifest)
}

/// Fetch this platform's release manifest, uncached.
/// @returns None on any network, status or validation failure
pub(crate) async fn fetch_manifest() -> Option<Manifest> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let musl = cfg!(target_env = "musl");
    let target = target(os, arch, musl)?;
    let fetch = async {
        let client = reqwest::Client::builder().timeout(TIMEOUT).build().ok()?;
        let bytes = client
            .get(format!("{MANIFEST_BASE}/{target}.json"))
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .bytes()
            .await
            .ok()?;
        parse_manifest(&bytes, os, arch, musl)
    };
    tokio::time::timeout(TIMEOUT, fetch).await.ok().flatten()
}

pub(super) async fn latest_version() -> Option<String> {
    static CACHE: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
    {
        let guard = CACHE.lock().unwrap();
        if let Some((at, version)) = guard.as_ref() {
            if at.elapsed() < TTL {
                return version.clone();
            }
        }
    }
    let version = fetch_manifest().await.map(|m| m.version);
    *CACHE.lock().unwrap() = Some((Instant::now(), version.clone()));
    version
}

#[cfg(test)]
mod tests;
