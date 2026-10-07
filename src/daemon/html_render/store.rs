//! Published pages, one directory per task under `~/.warpforge/renders/`. The
//! desktop serves them from there by task and render id (`wf-render://`), so
//! the layout is part of the contract with `desktop/src-tauri/src/html_render`.

use std::path::PathBuf;

use crate::daemon::workflow::evidence::is_plain_component;

fn root() -> PathBuf {
    // Tests never write into the user's home.
    if cfg!(test) {
        return std::env::temp_dir().join(format!("warpforge-renders-{}", std::process::id()));
    }
    crate::registry::warpforge_dir().join("renders")
}

/// The directory holding one task's pages.
/// @param task_id the task
/// @returns the directory, or `None` for an id that is not a plain name
pub(crate) fn task_dir(task_id: &str) -> Option<PathBuf> {
    is_plain_component(task_id).then(|| root().join(task_id))
}

fn page_path(task_id: &str, render_id: &str) -> Result<PathBuf, String> {
    let dir = task_dir(task_id).ok_or("not a task id")?;
    if !is_plain_component(render_id) {
        return Err("not a render id".into());
    }
    Ok(dir.join(format!("{render_id}.html")))
}

/// Write a page, bootstrap already injected.
/// @param task_id the task whose chat shows it
/// @param render_id the page's id
/// @param html the page
/// @returns why it was not written
pub(crate) fn write(task_id: &str, render_id: &str, html: &str) -> Result<(), String> {
    let path = page_path(task_id, render_id)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("creating {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, html).map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Delete one page, as when publishing it failed. Best effort.
/// @param task_id the task
/// @param render_id the page's id
pub(crate) fn remove(task_id: &str, render_id: &str) {
    if let Ok(path) = page_path(task_id, render_id) {
        let _ = std::fs::remove_file(path);
    }
}

/// Delete every page of a task along with it. Best effort.
/// @param task_id the task
pub(crate) fn remove_task(task_id: &str) {
    if let Some(dir) = task_dir(task_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_round_trip_and_paths_are_refused() {
        let task = "t_store_roundtrip";
        write(task, "r_1", "<p>one</p>").unwrap();
        write(task, "r_2", "<p>two</p>").unwrap();
        let dir = task_dir(task).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("r_1.html")).unwrap(),
            "<p>one</p>"
        );

        remove(task, "r_1");
        assert!(!dir.join("r_1.html").exists());
        assert!(dir.join("r_2.html").exists());

        assert!(write("..", "r_1", "x").is_err());
        assert!(write("a/b", "r_1", "x").is_err());
        assert!(write("", "r_1", "x").is_err());
        assert!(write(task, "../r", "x").is_err());

        remove_task(task);
        assert!(!dir.exists());
    }
}
