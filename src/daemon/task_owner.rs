//! Shared-checkout descendants attribute branch ownership to their root task.
use super::task::Task;
use std::collections::HashSet;

/// Resolve ownership without crossing a project or isolated checkout boundary.
/// @param task task whose branch ownership is being resolved
/// @param lookup task lookup in the current snapshot
/// @returns the root owner, or the last reachable task for a broken parent chain
pub(crate) fn root_owner<'a>(
    task: &'a Task,
    lookup: impl Fn(&str) -> Option<&'a Task>,
) -> &'a Task {
    let mut owner = task;
    let mut seen = HashSet::new();
    while owner.worktree.is_none() && seen.insert(&owner.id) {
        let Some(parent) = owner.parent_task_id.as_deref().and_then(&lookup) else {
            break;
        };
        if parent.project != task.project || parent.worktree.is_some() {
            break;
        }
        owner = parent;
    }
    owner
}
