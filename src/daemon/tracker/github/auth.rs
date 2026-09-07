//! The GitHub credential: a PAT from the environment or the keychain, and the
//! login the `gh` session acts as.

use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;

use super::KEYCHAIN_SERVICE;

fn security_bin() -> Option<PathBuf> {
    cfg!(target_os = "macos").then(|| PathBuf::from("/usr/bin/security"))
}

pub fn github_keychain_read() -> Option<String> {
    if let Some(tok) = std::env::var("GH_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        return Some(tok);
    }
    if let Some(tok) = std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        return Some(tok);
    }
    let bin = security_bin()?;
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
    if !out.status.success() {
        return None;
    }
    let secret = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!secret.is_empty()).then_some(secret)
}

pub fn github_token() -> Option<String> {
    github_keychain_read()
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

fn github_api_client(_token: &str) -> reqwest::Client {
    reqwest::Client::new()
}
pub(super) fn _github_token_header(token: &str) -> String {
    format!("Bearer {token}")
}

/// The `gh` login the API will act as. Returns None when unauthenticated.
pub async fn github_login() -> Option<String> {
    #[allow(deprecated)]
    let out = super::cli::gh(None, &["api", "user", "--jq", ".login"])
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let login = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!login.is_empty()).then_some(login)
}
