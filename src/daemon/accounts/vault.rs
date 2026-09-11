use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

/// Marker file written into every vault directory, containing the account id.
pub(crate) const OWNERSHIP_MARKER: &str = ".warpforge-account";

/// Root of all account vaults: `~/.warpforge/accounts`.
pub fn accounts_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".warpforge")
        .join("accounts")
}

/// Vault path for an account. Path only — does not create anything, so
/// read-only callers cannot materialize a vault as a side effect.
pub fn vault_path(agent_id: &str, slug: &str) -> PathBuf {
    accounts_root().join(agent_id).join(slug)
}

/// Turn a user-supplied label into a filesystem-safe slug. Anything that is not
/// alphanumeric, `-` or `_` collapses to `-`, so a label can never escape the
/// accounts root or collide with a marker file.
pub fn slugify(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut last_dash = false;
    for ch in label.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        "account".to_string()
    } else {
        slug
    }
}

/// Account id: stable, agent-scoped, derived from the slug.
pub fn account_id(agent_id: &str, slug: &str) -> String {
    format!("{agent_id}:{slug}")
}

/// Create a vault directory (0700) and stamp it with its ownership marker.
/// Fails if the path exists and belongs to another account.
pub fn create_vault(agent_id: &str, slug: &str, id: &str) -> Result<PathBuf> {
    create_vault_under(&accounts_root(), agent_id, slug, id)
}

/// `create_vault` against an explicit root, so the checks can be exercised
/// without writing into the real home directory.
pub(crate) fn create_vault_under(
    root: &Path,
    agent_id: &str,
    slug: &str,
    id: &str,
) -> Result<PathBuf> {
    let path = root.join(agent_id).join(slug);
    if !path.exists() {
        std::fs::create_dir_all(&path)
            .with_context(|| format!("creating account vault {}", path.display()))?;
        set_owner_only(&path)?;
    }
    // Stamp any unmarked directory sitting at the one path this account owns.
    // Besides the fresh create, that covers a husk: removing an account deletes
    // the vault, but an agent still spawned against it recreates the directory
    // as it writes caches back, and an unmarked husk would otherwise reject
    // every future import at this path with no way out from the UI. Only a real
    // directory is stamped — `symlink_metadata` reports a symlink as such, so a
    // redirected path falls through to be rejected below, as does a marker
    // naming somebody else.
    let marker = path.join(OWNERSHIP_MARKER);
    if !marker.exists() && std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
        std::fs::write(&marker, format!("{id}\n")).context("writing account ownership marker")?;
    }
    verify_vault_under(root, &path, id)
}

/// Prove a stored vault path is ours before reading or writing through it:
/// it must resolve inside the accounts root, not be a symlink, and carry a
/// marker naming this account. Returns the canonical path on success.
pub fn verify_vault(path: &Path, id: &str) -> Result<PathBuf> {
    verify_vault_under(&accounts_root(), path, id)
}

/// `verify_vault` against an explicit root, so the checks can be exercised
/// without writing into the real home directory.
pub(crate) fn verify_vault_under(root: &Path, path: &Path, id: &str) -> Result<PathBuf> {
    let root = root.to_path_buf();
    if !path.exists() {
        bail!("account vault {} does not exist", path.display());
    }
    let meta = std::fs::symlink_metadata(path)
        .with_context(|| format!("reading account vault {}", path.display()))?;
    if meta.file_type().is_symlink() {
        bail!("account vault {} is a symlink", path.display());
    }
    if !meta.is_dir() {
        bail!("account vault {} is not a directory", path.display());
    }
    let canonical = std::fs::canonicalize(path)
        .with_context(|| format!("resolving account vault {}", path.display()))?;
    // The root may not exist yet on a fresh install; canonicalize it when it
    // does so a symlinked home directory still compares equal.
    let canonical_root = std::fs::canonicalize(&root).unwrap_or(root);
    if !canonical.starts_with(&canonical_root) || canonical == canonical_root {
        bail!(
            "account vault {} is outside {}",
            canonical.display(),
            canonical_root.display()
        );
    }
    let marker = canonical.join(OWNERSHIP_MARKER);
    let marker_meta = std::fs::symlink_metadata(&marker)
        .with_context(|| format!("account vault {} has no ownership marker", path.display()))?;
    if marker_meta.file_type().is_symlink() || !marker_meta.is_file() {
        bail!(
            "ownership marker in {} is not a regular file",
            path.display()
        );
    }
    let owner = std::fs::read_to_string(&marker).context("reading account ownership marker")?;
    if owner.trim() != id {
        bail!(
            "account vault {} belongs to {}, not {id}",
            path.display(),
            owner.trim()
        );
    }
    Ok(canonical)
}

/// Read a file from a verified vault. Refuses symlinks and anything outside the
/// vault, so a swapped-in link cannot redirect the read.
pub fn read_vault_file(vault: &Path, name: &str) -> Result<Option<String>> {
    let path = vault.join(name);
    if !is_owned_regular_file(vault, &path) {
        return Ok(None);
    }
    Ok(Some(
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?,
    ))
}

/// Write a file into a verified vault with owner-only permissions, refusing to
/// follow a symlink planted at the destination.
pub fn write_vault_file(vault: &Path, name: &str, contents: &str) -> Result<()> {
    let path = vault.join(name);
    if path.exists() && !is_owned_regular_file(vault, &path) {
        bail!(
            "{} is not a regular file owned by this vault",
            path.display()
        );
    }
    std::fs::write(&path, contents).with_context(|| format!("writing {}", path.display()))?;
    set_owner_only(&path)?;
    Ok(())
}

/// Remove an account's vault. Verifies ownership first so a bad row can never
/// point the daemon at someone else's directory.
pub fn remove_vault(path: &Path, id: &str) -> Result<()> {
    let canonical = verify_vault(path, id)?;
    std::fs::remove_dir_all(&canonical)
        .with_context(|| format!("removing account vault {}", canonical.display()))
}

fn is_owned_regular_file(vault: &Path, path: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return false;
    }
    match (std::fs::canonicalize(vault), std::fs::canonicalize(path)) {
        (Ok(vault), Ok(file)) => file.starts_with(&vault) && file != vault,
        _ => false,
    }
}

#[cfg(unix)]
fn set_owner_only(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let meta = std::fs::metadata(path)?;
    let mode = if meta.is_dir() { 0o700 } else { 0o600 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .with_context(|| format!("restricting permissions on {}", path.display()))
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path) -> Result<()> {
    Ok(())
}
