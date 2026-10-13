//! The CLI's live credentials and our managed copies: the keychain items and
//! the `.credentials.json` fallback.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};

use super::{write_secret_file, ClaudeRuntime, ACTIVE_SERVICE, CREDENTIALS_FILE, MANAGED_SERVICE};

impl ClaudeRuntime {
    pub(super) fn credentials_path(&self) -> PathBuf {
        self.config_dir.join(CREDENTIALS_FILE)
    }

    /// Keychain service scoped to this config dir, as Claude Code 2.1+ derives it.
    pub(super) fn scoped_service(&self) -> String {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(self.config_dir.to_string_lossy().as_bytes());
        let hex: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
        format!("{ACTIVE_SERVICE}-{hex}")
    }

    /// Services to try when reading, newest scheme first.
    pub(super) fn active_services(&self) -> Vec<String> {
        vec![self.scoped_service(), ACTIVE_SERVICE.to_string()]
    }

    /// The credentials the CLI would use right now: scoped keychain item, then
    /// the legacy one, then the file. Returns `None` when not logged in.
    pub fn read_live_credentials(&self) -> Result<Option<String>> {
        for service in self.active_services() {
            if let Some(secret) = self.keychain_read(&service, &self.user)? {
                return Ok(Some(secret));
            }
        }
        let path = self.credentials_path();
        if path.is_file() {
            return Ok(Some(std::fs::read_to_string(&path)?));
        }
        Ok(None)
    }

    /// Make `credentials` the live login: the file, the canonical keychain
    /// item, and the scoped one *if the CLI is already using it*.
    ///
    /// Creating a scoped item that Claude does not read would be worse than
    /// useless: reads prefer the scoped service, so the invented item would
    /// shadow the canonical one and go stale the next time the user logs in
    /// from a terminal — handing back an old token on the next switch.
    /// Verified on this machine: with the default `~/.claude`, only the
    /// unsuffixed service exists.
    pub fn write_live_credentials(&self, credentials: &str) -> Result<()> {
        std::fs::create_dir_all(&self.config_dir)
            .with_context(|| format!("creating {}", self.config_dir.display()))?;
        // Only refresh a credentials file that the CLI already maintains.
        // Creating one where there was none adds a second source of truth that
        // nothing updates: Claude rotates its token into the keychain, the file
        // keeps the old one, and whichever the CLI happens to read next decides
        // whether the user is logged in.
        let path = self.credentials_path();
        let file_exists = path.is_file();
        let scoped = self.scoped_service();
        let scoped_exists = self.keychain_read(&scoped, &self.user)?.is_some();
        if file_exists || (!scoped_exists && self.security_bin.is_none()) {
            write_secret_file(&path, credentials)?;
        }
        if scoped_exists {
            self.keychain_write(&scoped, &self.user, credentials)?;
        }
        self.keychain_write(ACTIVE_SERVICE, &self.user, credentials)
    }

    /// Our own per-account copy, kept in the keychain when there is one.
    pub fn read_managed_credentials(&self, account_id: &str) -> Result<Option<String>> {
        self.keychain_read(MANAGED_SERVICE, account_id)
    }

    pub fn write_managed_credentials(&self, account_id: &str, credentials: &str) -> Result<()> {
        self.keychain_write(MANAGED_SERVICE, account_id, credentials)
    }

    pub fn delete_managed_credentials(&self, account_id: &str) -> Result<()> {
        let Some(bin) = &self.security_bin else {
            return Ok(());
        };
        let output = std::process::Command::new(bin)
            .args(["delete-generic-password", "-s", MANAGED_SERVICE, "-a"])
            .arg(account_id)
            .output();
        // A missing item is the desired end state, not an error.
        let _ = output;
        Ok(())
    }

    pub(super) fn keychain_read(&self, service: &str, account: &str) -> Result<Option<String>> {
        const ITEM_NOT_FOUND: i32 = 44;
        let Some(bin) = &self.security_bin else {
            return Ok(None);
        };
        let output = std::process::Command::new(bin)
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .with_context(|| format!("running {}", bin.display()))?;
        if let Some(code) = output.status.code() {
            if code == ITEM_NOT_FOUND {
                return Ok(None);
            }
            if !output.status.success() {
                // A missing item is "not logged in", but anything else — an ACL
                // that does not admit `security`, a locked keychain — means the
                // login state is unknown. Callers must see the difference
                // instead of reading a permission failure as "nothing there".
                anyhow::bail!(
                    "keychain read failed for {service}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((!secret.is_empty()).then_some(secret))
    }

    pub(super) fn keychain_write(&self, service: &str, account: &str, secret: &str) -> Result<()> {
        let Some(bin) = &self.security_bin else {
            return Ok(());
        };
        let output = std::process::Command::new(bin)
            .args([
                "add-generic-password",
                "-U",
                "-s",
                service,
                "-a",
                account,
                "-w",
            ])
            .arg(secret)
            .output()
            .with_context(|| format!("running {}", bin.display()))?;
        if !output.status.success() {
            bail!(
                "keychain write failed for {service}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }
}
