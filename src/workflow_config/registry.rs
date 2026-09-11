use super::{parse_workflow, workflows_dir, LoadedWorkflow, WorkflowSource, BUILTIN_WORKFLOWS};
use anyhow::{bail, Context, Result};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

// ─── Disk access ─────────────────────────────────────────────────────────────

/// All workflows visible to a project: `.warpforge/workflows/*.{yaml,yml}`
/// (sorted by file name; on duplicate stems the first file wins) followed by
/// built-ins not overridden by a project file with the same id.
pub fn list_workflows(project_path: &Path) -> Vec<LoadedWorkflow> {
    let mut out: Vec<LoadedWorkflow> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut files: Vec<PathBuf> = fs::read_dir(workflows_dir(project_path))
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
            if let Some(existing) = out.iter_mut().find(|w| w.id == id) {
                existing
                    .warnings
                    .push(format!("duplicate workflow file ignored: {file_name}"));
            }
            continue;
        }
        let (spec, warnings) = match fs::read_to_string(&path) {
            Ok(text) => parse_workflow(&id, &text),
            Err(e) => (Err(format!("reading {file_name}: {e}")), Vec::new()),
        };
        out.push(LoadedWorkflow {
            id,
            source: WorkflowSource::Project,
            spec,
            warnings,
        });
    }

    for (id, text) in BUILTIN_WORKFLOWS {
        if seen.contains(*id) {
            continue;
        }
        let (spec, warnings) = parse_workflow(id, text);
        out.push(LoadedWorkflow {
            id: (*id).to_string(),
            source: WorkflowSource::Builtin,
            spec,
            warnings,
        });
    }

    out
}

/// Load one workflow by id: the project file wins over a built-in.
/// Consumed by the workflow engine when a task starts with a workflow.
#[allow(dead_code)]
pub fn load_workflow(project_path: &Path, id: &str) -> Option<LoadedWorkflow> {
    list_workflows(project_path)
        .into_iter()
        .find(|w| w.id == id)
}

/// Copy a built-in workflow into the project's workflows directory so the
/// user can customize it. Refuses to overwrite an existing file.
pub fn eject_builtin(project_path: &Path, id: &str) -> Result<PathBuf> {
    let Some((_, text)) = BUILTIN_WORKFLOWS.iter().find(|(bid, _)| *bid == id) else {
        bail!("no built-in workflow `{id}`");
    };
    let dir = workflows_dir(project_path);
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    for ext in ["yaml", "yml"] {
        let existing = dir.join(format!("{id}.{ext}"));
        if existing.exists() {
            bail!("{} already exists", existing.display());
        }
    }
    let target = dir.join(format!("{id}.yaml"));
    fs::write(&target, text).with_context(|| format!("writing {}", target.display()))?;
    Ok(target)
}
