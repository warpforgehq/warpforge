//! Folders for chats: tasks with no project, each run in its own directory
//! under the data dir instead of a checkout.

use std::path::{Path, PathBuf};

/// @returns the directory every chat folder lives in
pub fn root() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join(format!("wf-scratch-test-{}", std::process::id()))
    } else {
        crate::registry::warpforge_dir().join("scratch")
    }
}

/// @param task_id the chat
/// @returns the chat's folder, whether or not it exists yet
pub fn chat_dir(task_id: &str) -> PathBuf {
    root().join(task_id)
}

/// Inside a checkout, git commands an agent runs in a chat folder would act on
/// that checkout's repository.
/// @param root the scratch root
/// @returns why chats cannot be created there, or `None` when they can
pub fn refusal(root: &Path) -> Option<String> {
    let checkout = root.ancestors().find(|dir| dir.join(".git").exists())?;
    Some(format!(
        "chats are unavailable: the Warpforge data folder is inside the git checkout {}",
        checkout.display()
    ))
}

/// @param task_id the chat
/// @returns the created folder, or why it could not be created
pub fn create(task_id: &str) -> Result<PathBuf, String> {
    let root = root();
    if let Some(reason) = refusal(&root) {
        return Err(reason);
    }
    let dir = root.join(task_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create chat folder {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Counts files, not directories, and does not follow symlinks.
/// @param dir the folder to count
/// @returns how many files are under it; 0 when it does not exist
pub fn file_count(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => file_count(&entry.path()),
            Ok(_) => 1,
            Err(_) => 0,
        })
        .sum()
}

/// An empty folder always goes; one with files only when `with_files`.
/// @param task_id the chat being deleted
/// @param with_files whether the user agreed to delete the files in it
pub fn remove(task_id: &str, with_files: bool) -> std::io::Result<()> {
    let dir = chat_dir(task_id);
    if !dir.exists() || (!with_files && file_count(&dir) > 0) {
        return Ok(());
    }
    std::fs::remove_dir_all(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wf-scratch-unit-{tag}-{}",
            &uuid::Uuid::new_v4().to_string()[..8]
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_root_inside_a_git_checkout_is_refused() {
        let repo = temp("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let reason = refusal(&repo.join("home/.warpforge/scratch")).expect("refused");
        assert!(reason.contains(repo.to_str().unwrap()), "{reason}");
        assert!(refusal(&temp("plain").join("scratch")).is_none());
    }

    #[test]
    fn file_count_counts_nested_files_only() {
        let dir = temp("count");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::create_dir_all(dir.join("empty")).unwrap();
        std::fs::write(dir.join("one.txt"), "1").unwrap();
        std::fs::write(dir.join("a/b/two.txt"), "2").unwrap();
        assert_eq!(file_count(&dir), 2);
        assert_eq!(file_count(&dir.join("missing")), 0);
    }

    #[test]
    fn remove_keeps_files_unless_asked() {
        let id = format!("t_{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let dir = create(&id).unwrap();
        std::fs::write(dir.join("notes.md"), "keep me").unwrap();
        remove(&id, false).unwrap();
        assert!(dir.join("notes.md").exists());
        remove(&id, true).unwrap();
        assert!(!dir.exists());

        let empty = create(&id).unwrap();
        remove(&id, false).unwrap();
        assert!(!empty.exists());
    }
}
