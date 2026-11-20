use std::path::{Path, PathBuf};

use super::Manifest;

/// What the agent panel reports as the install and update command for the
/// managed CLI; the real work is [`install_script`].
pub(crate) const MANAGED_LABEL: &str = "Download agy from Google's release manifest";

fn managed_root() -> PathBuf {
    crate::registry::warpforge_dir().join("agents/antigravity")
}

fn managed_bin() -> PathBuf {
    managed_root().join("bin")
}

/// Append the managed launcher's directory to the daemon's `PATH`, after the
/// user's own entries so an `agy` they installed themselves still wins.
/// Call once at daemon start, before any task spawns.
pub(crate) fn expose_managed_bin() {
    let bin = managed_bin();
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if dirs.contains(&bin) {
        return;
    }
    dirs.push(bin);
    if let Ok(path) = std::env::join_paths(dirs) {
        std::env::set_var("PATH", path);
    }
}

/// Whether a resolved `agy` is the launcher Warpforge installed.
/// @param path the binary path `which` resolved
/// @returns false for an `agy` the user installed some other way
pub(crate) fn is_managed(path: &str) -> bool {
    is_managed_under(&managed_root(), path)
}

pub(super) fn is_managed_under(root: &Path, path: &str) -> bool {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    Path::new(path).starts_with(root)
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// The `sh` script that installs `manifest`'s release into the managed root.
/// Every step before the final `mv` of the launcher can fail without touching
/// the active version; older versions are pruned only after the swap.
/// @param manifest a manifest that passed validation
/// @returns None on platforms without a tar.gz release
pub(crate) fn install_script(manifest: &Manifest) -> Option<String> {
    install_script_at(&managed_root(), manifest)
}

pub(super) fn install_script_at(root: &Path, manifest: &Manifest) -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    let root = quote(root.to_str()?);
    let version = quote(&manifest.version);
    let url = quote(&manifest.url);
    let sha512 = quote(&manifest.sha512);
    Some(format!(
        r#"set -eu
root={root}; version={version}
mkdir -p "$root/bin"
tmp=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --proto '=https' -o "$tmp/cli.tar.gz" {url}
if command -v sha512sum >/dev/null 2>&1; then sum=$(sha512sum "$tmp/cli.tar.gz"); else sum=$(shasum -a 512 "$tmp/cli.tar.gz"); fi
if [ "${{sum%% *}}" != {sha512} ]; then echo "agy download failed its SHA-512 check; nothing was installed" >&2; exit 1; fi
tar -xOzf "$tmp/cli.tar.gz" antigravity > "$tmp/antigravity"
chmod 755 "$tmp/antigravity"
mkdir -p "$root/$version"
mv -f "$tmp/antigravity" "$root/$version/antigravity"
printf '#!/bin/sh\nAGY_CLI_DISABLE_AUTO_UPDATE=1 exec "%s" "$@"\n' "$root/$version/antigravity" > "$tmp/agy"
chmod 755 "$tmp/agy"
mv -f "$tmp/agy" "$root/bin/agy"
for dir in "$root"/[0-9]*; do [ "$dir" = "$root/$version" ] || rm -rf "$dir"; done
echo "Installed agy $version""#
    ))
}
