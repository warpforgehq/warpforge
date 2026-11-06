use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use warpforge_protocol as wire;

use super::{keepers_dir, parse_keeper};

/// The project's keeper files, `.yaml` and `.yml`, sorted by file name; on a
/// duplicate stem the first file wins. Built-in presets are not listed: one
/// runs only when a file here names it.
/// @param project_path the project's root
/// @returns one entry per keeper id
pub fn list_keepers(project_path: &Path) -> Vec<wire::KeeperEntry> {
    let mut files: Vec<PathBuf> = fs::read_dir(keepers_dir(project_path))
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    matches!(
                        path.extension().and_then(|e| e.to_str()),
                        Some("yaml") | Some("yml")
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();

    let mut out: Vec<wire::KeeperEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for path in files {
        let Some(id) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !seen.insert(id.clone()) {
            if let Some(existing) = out.iter_mut().find(|k| k.id == id) {
                existing
                    .warnings
                    .push(format!("duplicate keeper file ignored: {file_name}"));
            }
            continue;
        }
        let (definition, warnings) = match fs::read_to_string(&path) {
            Ok(text) => parse_keeper(&id, &text),
            Err(e) => (Err(format!("reading {file_name}: {e}")), Vec::new()),
        };
        let (definition, error) = match definition {
            Ok(definition) => (Some(definition), None),
            Err(error) => (None, Some(error)),
        };
        out.push(wire::KeeperEntry {
            id,
            definition,
            error,
            warnings,
        });
    }
    out
}
