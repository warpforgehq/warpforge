//! Reading and writing single files in a checkout — the editor's side of the
//! review surface.

use anyhow::{bail, Result};
use tokio::process::Command;
use warpforge_protocol as wire;

/// A file's old (HEAD) and new (working-tree) text, for the editable review.
pub async fn file_doc(repo: &str, path: &str) -> Result<wire::FileDoc> {
    if path.contains("..") {
        bail!("refusing path with ..: {path}");
    }

    let is_image = is_image_path(path);

    if is_image {
        return file_doc_binary(repo, path).await;
    }

    let show = Command::new("git")
        .args(["-C", repo, "show", &format!("HEAD:{path}")])
        .output()
        .await?;
    let in_head = show.status.success();
    let old_text = if in_head {
        String::from_utf8_lossy(&show.stdout).to_string()
    } else {
        String::new()
    };

    let full = std::path::Path::new(repo).join(path);
    let in_tree = full.is_file();
    let new_text = if in_tree {
        std::fs::read_to_string(&full).unwrap_or_default()
    } else {
        String::new()
    };

    let status = match (in_head, in_tree) {
        (true, true) => wire::FileDiffStatus::Modified,
        (false, true) => wire::FileDiffStatus::Added,
        (true, false) => wire::FileDiffStatus::Deleted,
        (false, false) => wire::FileDiffStatus::Modified,
    };
    Ok(wire::FileDoc {
        path: path.to_string(),
        status,
        old_text,
        new_text,
        new_data_base64: None,
        old_data_base64: None,
    })
}

/// Binary file variant — returns base64-encoded content for images.
async fn file_doc_binary(repo: &str, path: &str) -> Result<wire::FileDoc> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let show = Command::new("git")
        .args(["-C", repo, "show", &format!("HEAD:{path}")])
        .output()
        .await?;
    let in_head = show.status.success();
    let old_data_base64 = if in_head {
        Some(STANDARD.encode(&show.stdout))
    } else {
        None
    };

    let full = std::path::Path::new(repo).join(path);
    let in_tree = full.is_file();
    let new_data_base64 = if in_tree {
        let bytes = std::fs::read(&full)?;
        Some(STANDARD.encode(bytes))
    } else {
        None
    };

    let status = match (in_head, in_tree) {
        (true, true) => wire::FileDiffStatus::Modified,
        (false, true) => wire::FileDiffStatus::Added,
        (true, false) => wire::FileDiffStatus::Deleted,
        (false, false) => wire::FileDiffStatus::Modified,
    };
    Ok(wire::FileDoc {
        path: path.to_string(),
        status,
        old_text: String::new(),
        new_text: String::new(),
        new_data_base64,
        old_data_base64,
    })
}

/// Check if path is a binary image file.
fn is_image_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".ico")
        || lower.ends_with(".bmp")
}

/// Write new contents to a file in the working tree (an in-review edit).
pub fn save_file(repo: &str, path: &str, content: &str) -> Result<()> {
    validate_relative_path(path)?;
    let full = std::path::Path::new(repo).join(path);
    if let Some(dir) = full.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(full, content)?;
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<()> {
    let p = std::path::Path::new(path);
    if path.is_empty() || p.is_absolute() || path.split('/').any(|part| part == "..") {
        bail!("refusing unsafe relative path: {path}");
    }
    Ok(())
}

/// Resolve `path` under `repo`, following symlinks in its existing parent
/// directories and refusing anything that lands outside the root. The last
/// component is never followed: these ops act on a link, not on its target.
fn resolve_in_root(repo: &str, path: &str) -> Result<std::path::PathBuf> {
    validate_relative_path(path)?;
    let root = std::fs::canonicalize(repo)?;
    let parts: Vec<&str> = path
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    let Some((leaf, parents)) = parts.split_last() else {
        bail!("refusing unsafe relative path: {path}");
    };
    let mut dir = root.clone();
    for part in parents {
        let candidate = dir.join(part);
        dir = std::fs::canonicalize(&candidate).unwrap_or(candidate);
        if !dir.starts_with(&root) {
            bail!("refusing path outside the root: {path}");
        }
    }
    Ok(dir.join(leaf))
}

pub fn create_file(repo: &str, path: &str, directory: bool) -> Result<()> {
    let full = resolve_in_root(repo, path)?;
    if directory {
        std::fs::create_dir_all(full)?;
    } else {
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(full)?;
    }
    Ok(())
}

pub fn rename_file(repo: &str, path: &str, new_path: &str) -> Result<()> {
    let from = resolve_in_root(repo, path)?;
    let to = resolve_in_root(repo, new_path)?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

pub fn delete_file(repo: &str, path: &str) -> Result<()> {
    let full = resolve_in_root(repo, path)?;
    let metadata = std::fs::symlink_metadata(&full)?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(full)?;
    } else {
        std::fs::remove_file(full)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{create_file, delete_file, rename_file};

    struct Fixture {
        repo: tempfile::TempDir,
        outside: tempfile::TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                repo: tempfile::tempdir().unwrap(),
                outside: tempfile::tempdir().unwrap(),
            }
        }

        fn root(&self) -> String {
            self.repo.path().to_string_lossy().to_string()
        }

        /// A symlink inside the repo pointing at the sibling temp dir.
        fn escape_link(&self, name: &str) -> String {
            std::os::unix::fs::symlink(self.outside.path(), self.repo.path().join(name)).unwrap();
            name.to_string()
        }
    }

    #[test]
    fn creates_a_file_and_a_directory_inside_the_root() {
        let fx = Fixture::new();
        create_file(&fx.root(), "src/main.rs", false).unwrap();
        create_file(&fx.root(), "docs/adr", true).unwrap();
        assert!(fx.repo.path().join("src/main.rs").is_file());
        assert!(fx.repo.path().join("docs/adr").is_dir());
    }

    #[test]
    fn creating_the_same_file_twice_fails() {
        let fx = Fixture::new();
        create_file(&fx.root(), "a.txt", false).unwrap();
        assert!(create_file(&fx.root(), "a.txt", false).is_err());
    }

    #[test]
    fn renames_inside_the_root_and_overwrites_an_existing_target() {
        let fx = Fixture::new();
        std::fs::write(fx.repo.path().join("from.txt"), "new").unwrap();
        std::fs::write(fx.repo.path().join("onto.txt"), "old").unwrap();
        rename_file(&fx.root(), "from.txt", "nested/moved.txt").unwrap();
        assert!(fx.repo.path().join("nested/moved.txt").is_file());

        rename_file(&fx.root(), "nested/moved.txt", "onto.txt").unwrap();
        let onto = std::fs::read_to_string(fx.repo.path().join("onto.txt")).unwrap();
        assert_eq!(onto, "new");
    }

    #[test]
    fn deletes_a_file_and_a_directory_tree() {
        let fx = Fixture::new();
        create_file(&fx.root(), "tree/a.txt", false).unwrap();
        delete_file(&fx.root(), "tree/a.txt").unwrap();
        assert!(!fx.repo.path().join("tree/a.txt").exists());

        delete_file(&fx.root(), "tree").unwrap();
        assert!(!fx.repo.path().join("tree").exists());
    }

    #[test]
    fn a_relative_escape_is_refused() {
        let fx = Fixture::new();
        let outside = fx.outside.path().join("stolen.txt");
        std::fs::write(&outside, "keep").unwrap();
        let relative = format!(
            "../{}/stolen.txt",
            fx.outside.path().file_name().unwrap().to_string_lossy()
        );

        assert!(create_file(&fx.root(), &relative, false).is_err());
        assert!(rename_file(&fx.root(), &relative, "taken.txt").is_err());
        assert!(delete_file(&fx.root(), &relative).is_err());
        assert!(outside.is_file());
    }

    #[test]
    fn an_absolute_path_is_refused() {
        let fx = Fixture::new();
        let absolute = fx.outside.path().join("stolen.txt");
        std::fs::write(&absolute, "keep").unwrap();
        let absolute = absolute.to_string_lossy().to_string();

        assert!(create_file(&fx.root(), &absolute, false).is_err());
        assert!(rename_file(&fx.root(), "a.txt", &absolute).is_err());
        assert!(delete_file(&fx.root(), &absolute).is_err());
    }

    #[test]
    fn a_symlinked_parent_that_leaves_the_root_is_refused() {
        let fx = Fixture::new();
        let link = fx.escape_link("escape");
        let outside = fx.outside.path().join("stolen.txt");
        std::fs::write(&outside, "keep").unwrap();
        let through_link = format!("{link}/stolen.txt");

        assert!(create_file(&fx.root(), &format!("{link}/new.txt"), false).is_err());
        assert!(rename_file(&fx.root(), &through_link, "taken.txt").is_err());
        assert!(delete_file(&fx.root(), &through_link).is_err());
        assert!(outside.is_file());
        assert!(!fx.outside.path().join("new.txt").exists());
    }

    #[test]
    fn an_empty_path_is_refused() {
        let fx = Fixture::new();
        assert!(create_file(&fx.root(), "", false).is_err());
        assert!(rename_file(&fx.root(), "", "a.txt").is_err());
        assert!(delete_file(&fx.root(), "").is_err());
    }
}
