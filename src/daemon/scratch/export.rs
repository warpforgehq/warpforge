//! Copying a chat's folder out into a new project folder.

use std::path::{Component, Path, PathBuf};
use std::process::Command;

/// Rebuilt by the project's own tooling, and large enough to make the copy slow.
const SKIPPED_DIRS: [&str; 2] = ["node_modules", ".venv"];

/// A leading `~` is the home folder; the result is absolute, has no `..`, and
/// lies outside the scratch root, so the copy cannot land in a chat's folder.
/// @param raw the folder the client asked for
/// @param home the home folder, for `~`
/// @returns the folder to create, or why it is refused
pub fn resolve_target(raw: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let raw = raw.trim();
    let path = match raw.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => home
            .ok_or("the home folder is unknown, so `~` cannot be used")?
            .join(rest.trim_start_matches('/')),
        _ => PathBuf::from(raw),
    };
    if !path.is_absolute() {
        return Err(format!("`{raw}` is not a full path"));
    }
    if path.components().any(|c| c == Component::ParentDir) {
        return Err(format!("`{raw}` may not contain `..`"));
    }
    if path.file_name().is_none() {
        return Err(format!("`{raw}` has no folder name"));
    }
    let root = super::root();
    let inside_root = |p: &Path| {
        p.starts_with(&root)
            || root
                .canonicalize()
                .is_ok_and(|real| p.canonicalize().is_ok_and(|p| p.starts_with(real)))
    };
    if path.ancestors().any(inside_root) {
        return Err("the project folder cannot be inside the chats folder".into());
    }
    Ok(path)
}

/// Builds the project in a sibling staging folder and renames it into place:
/// the rename refuses a target that gained files meanwhile, and a failure
/// leaves nothing behind but what was already there.
/// @param src the chat's folder, left untouched
/// @param dest the new project folder; must be missing or empty
/// @param init_git whether to make it a git repository with a first commit
pub fn export(src: &Path, dest: &Path, init_git: bool) -> Result<(), String> {
    export_with(src, dest, init_git, &[])
}

/// @param git_env extra environment for the git commands
pub(super) fn export_with(
    src: &Path,
    dest: &Path,
    init_git: bool,
    git_env: &[(&str, &str)],
) -> Result<(), String> {
    if !std::fs::symlink_metadata(src).is_ok_and(|meta| meta.is_dir()) {
        return Err("the chat's folder is missing or is a link; nothing was copied".into());
    }
    refuse_non_empty(dest)?;
    let parent = dest.parent().ok_or("the project folder has no parent")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    let name = dest.file_name().unwrap_or_default().to_string_lossy();
    let staging = parent.join(format!(
        ".{name}.warpforge-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    ));
    let built = build(src, &staging, init_git, git_env).and_then(|()| {
        std::fs::rename(&staging, dest).map_err(|e| match refuse_non_empty(dest) {
            Err(reason) => reason,
            Ok(()) => format!("could not move the files into {}: {e}", dest.display()),
        })
    });
    if built.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    built
}

fn refuse_non_empty(dest: &Path) -> Result<(), String> {
    let Ok(meta) = std::fs::symlink_metadata(dest) else {
        return Ok(());
    };
    let empty = meta.is_dir()
        && std::fs::read_dir(dest)
            .map_err(|e| format!("could not read {}: {e}", dest.display()))?
            .next()
            .is_none();
    match empty {
        true => Ok(()),
        false => Err(format!(
            "{} already exists and is not empty; choose a new folder",
            dest.display()
        )),
    }
}

fn build(
    src: &Path,
    staging: &Path,
    init_git: bool,
    git_env: &[(&str, &str)],
) -> Result<(), String> {
    std::fs::create_dir(staging)
        .map_err(|e| format!("could not create {}: {e}", staging.display()))?;
    copy_tree(src, staging, init_git)
        .map_err(|e| format!("could not copy the chat's files: {e}"))?;
    if init_git {
        git(staging, &["init", "-q"], git_env)?;
        for ident in ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"] {
            git(staging, &["var", ident], git_env).map_err(|_| {
                "git does not know who you are: set user.name and user.email \
                 (git config --global user.email you@example.com), or turn off \
                 Initialize git"
                    .to_string()
            })?;
        }
        git(staging, &["add", "-A"], git_env)?;
        git(
            staging,
            &["commit", "-q", "--allow-empty", "-m", "Initial commit"],
            git_env,
        )?;
    }
    Ok(())
}

/// Symlinks are skipped: one pointing outside the chat's folder would carry
/// whatever it names into the project. With `fresh_git` the chat's own `.git`
/// stays behind, so the commit runs no hooks or config the chat wrote.
fn copy_tree(src: &Path, dest: &Path, fresh_git: bool) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = dest.join(entry.file_name());
        if kind.is_dir() {
            let name = entry.file_name();
            if SKIPPED_DIRS.iter().any(|skip| name == *skip) || (fresh_git && name == ".git") {
                continue;
            }
            std::fs::create_dir(&target)?;
            copy_tree(&entry.path(), &target, false)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn git(dir: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .envs(env.iter().copied())
        .output()
        .map_err(|e| format!("could not run git: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "git {} failed: {}",
        args[0],
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
