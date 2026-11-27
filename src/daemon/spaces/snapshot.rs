use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use warpforge_protocol::SpaceMember;

use super::Spaces;
use crate::registry::ProjectEntry;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct WorkspaceFolder {
    pub(super) name: String,
    pub(super) path: String,
    pub(super) realpath: String,
    pub(super) git: bool,
}

impl WorkspaceFolder {
    /// The folder as clients see it on a task.
    pub(crate) fn info(&self) -> warpforge_protocol::WorkspaceFolderInfo {
        warpforge_protocol::WorkspaceFolderInfo {
            name: self.name.clone(),
            path: self.path.clone(),
            git: self.git,
        }
    }
}

/// `root/link` with `..` resolved lexically, as linked members are compared.
pub(crate) fn linked_path(root: &Path, link: &Path) -> String {
    let mut clean = PathBuf::new();
    for component in root.join(link).components() {
        if component == Component::ParentDir {
            clean.pop();
        } else {
            clean.push(component);
        }
    }
    clean.to_string_lossy().into_owned()
}

pub(super) fn readable_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("folder path must be absolute");
    }
    let real = fs::canonicalize(path).context("resolving folder")?;
    fs::read_dir(&real).context("opening folder")?;
    Ok(real)
}

/// Prefer the absolute alias when its lexical spelling resolves to the same
/// directory. An adapter normalizing a symlink followed by `..` could
/// otherwise grant a different directory.
pub(super) fn logical_path(path: &Path, real: &Path) -> PathBuf {
    let mut clean = PathBuf::new();
    for component in path.components() {
        if component == Component::ParentDir {
            clean.pop();
        } else {
            clean.push(component);
        }
    }
    if fs::canonicalize(&clean).is_ok_and(|target| target == real) {
        clean
    } else {
        real.to_owned()
    }
}

impl Spaces {
    pub(crate) fn siblings(
        &self,
        primary: &ProjectEntry,
        projects: &[ProjectEntry],
    ) -> Vec<WorkspaceFolder> {
        let Some(space) = self.for_project(&primary.name) else {
            return Vec::new();
        };
        let primary_real = fs::canonicalize(&primary.path).ok();
        space
            .members
            .iter()
            .filter_map(|member| {
                let (name, path) = match member {
                    SpaceMember::Project { name } if *name == primary.name => return None,
                    SpaceMember::Project { name } => {
                        let Some(project) = projects.iter().find(|project| project.name == *name)
                        else {
                            eprintln!(
                                "[spaces] {}: skipping unregistered project {name}",
                                space.name
                            );
                            return None;
                        };
                        (name, &project.path)
                    }
                    SpaceMember::Folder { path, name } => (name, path),
                };
                let real = match readable_directory(Path::new(path)) {
                    Ok(real) => real,
                    Err(err) => {
                        eprintln!("[spaces] {}: skipping folder {path}: {err}", space.name);
                        return None;
                    }
                };
                if primary_real.as_ref() == Some(&real) {
                    return None;
                }
                let Some(realpath) = real.to_str() else {
                    eprintln!(
                        "[spaces] {}: skipping non-UTF-8 target for {path}",
                        space.name
                    );
                    return None;
                };
                let git_marker = real.join(".git");
                Some(WorkspaceFolder {
                    name: name.clone(),
                    path: logical_path(Path::new(path), &real)
                        .to_str()
                        .unwrap_or(realpath)
                        .to_owned(),
                    realpath: realpath.to_owned(),
                    git: git_marker.is_dir() || git_marker.is_file(),
                })
            })
            .collect()
    }
}

pub(crate) fn additional_directories(folders: &[WorkspaceFolder]) -> Vec<String> {
    let mut seen = HashSet::new();
    folders
        .iter()
        .flat_map(|folder| [&folder.path, &folder.realpath])
        .filter(|path| seen.insert(*path))
        .cloned()
        .collect()
}

pub(crate) fn workspace_folders(folders: &[WorkspaceFolder]) -> Option<String> {
    const CAP: usize = 3500;
    const END: &str = "</workspace_folders>";
    if folders.is_empty() {
        return None;
    }
    let mut block = String::from("<workspace_folders>\nUse these sibling folders from their main checkouts. Run Git commands and commit inside each repository separately.\n");
    let mut omitted = 0;
    for folder in folders {
        let name: String = folder
            .name
            .chars()
            .filter(|&c| !c.is_control() && !matches!(c, '<' | '>' | '\u{2028}' | '\u{2029}'))
            .take(100)
            .collect();
        let name = name.trim();
        let name = if name.is_empty() { "folder" } else { name };
        // Escape characters that could add a line or close the surrounding block.
        let path: String = folder
            .path
            .chars()
            .map(|c| match c {
                '<' => '‹',
                '>' => '›',
                c if c.is_control() || matches!(c, '\u{2028}' | '\u{2029}') => '�',
                c => c,
            })
            .collect();
        let kind = if folder.git {
            "Git repository"
        } else {
            "folder"
        };
        let line = format!("- {name} ({kind}): {path}\n");
        if block.len() + line.len() + END.len() + 40 <= CAP {
            block.push_str(&line);
        } else {
            omitted += 1;
        }
    }
    if omitted > 0 {
        block.push_str(&format!("- {omitted} more folders omitted\n"));
    }
    block.push_str(END);
    Some(block)
}
