use std::collections::HashMap;

use super::PullTarget;
use crate::daemon::task::Task;

/// Every live task with an isolated checkout, keyed by task id, plus every
/// folder task with an owned branch and every Factory task that ran in its
/// project checkout (`paths`, by project name).
/// Archived tasks sit folded on the sidebar's done shelf and are not worth a
/// `gh` call, except a Factory task, whose merge is what closes its backlog item.
pub(crate) fn targets(
    tasks: &[Task],
    paths: &HashMap<String, String>,
) -> HashMap<String, PullTarget> {
    tasks
        .iter()
        .filter(|task| task.status != crate::daemon::task::TaskStatus::Done || is_factory(task))
        .filter_map(|task| {
            let target = match task.worktree.clone() {
                Some(worktree) => PullTarget {
                    worktree,
                    base_branch: task.base_branch.clone(),
                    head: None,
                },
                None if is_factory(task) && task.base_branch.is_some() => PullTarget {
                    worktree: paths.get(&task.project)?.clone(),
                    base_branch: task.base_branch.clone(),
                    head: Some(format!(
                        "{}{}",
                        crate::daemon::worktree::TASK_BRANCH_PREFIX,
                        task.id
                    )),
                },
                None => {
                    let owner = crate::daemon::task_owner::root_owner(task, |id| {
                        tasks.iter().find(|t| t.id == id)
                    });
                    let branch = owner.keepers.as_ref()?.branch.as_ref()?;
                    if branch.is_empty()
                        || matches!(branch.as_str(), "main" | "master")
                        || task.base_branch.as_ref() == Some(branch)
                    {
                        return None;
                    }
                    PullTarget {
                        worktree: paths.get(&task.project)?.clone(),
                        base_branch: task.base_branch.clone(),
                        head: Some(branch.clone()),
                    }
                }
            };
            Some((task.id.clone(), target))
        })
        .collect()
}

fn is_factory(task: &Task) -> bool {
    task.tags
        .iter()
        .any(|tag| tag == crate::daemon::runner::RUNNER_TAG)
}
