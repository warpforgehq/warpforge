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

pub fn create_file(repo: &str, path: &str, directory: bool) -> Result<()> {
    validate_relative_path(path)?;
    let full = std::path::Path::new(repo).join(path);
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
    validate_relative_path(path)?;
    validate_relative_path(new_path)?;
    let from = std::path::Path::new(repo).join(path);
    let to = std::path::Path::new(repo).join(new_path);
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

pub fn delete_file(repo: &str, path: &str) -> Result<()> {
    validate_relative_path(path)?;
    let full = std::path::Path::new(repo).join(path);
    let metadata = std::fs::symlink_metadata(&full)?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(full)?;
    } else {
        std::fs::remove_file(full)?;
    }
    Ok(())
}
