use crate::daemon::actor::transcript::settled_candidate_is_deletable;

#[test]
fn kept_when_dirty_and_worktree_still_exists() {
    assert!(!settled_candidate_is_deletable(3, true, false));
}

#[test]
fn deleted_when_dirty_but_worktree_is_gone() {
    // `files_changed` is a stale count from the task's last run; with no
    // worktree left there is nothing it could still be protecting.
    assert!(settled_candidate_is_deletable(3, false, false));
}

#[test]
fn deleted_when_worktree_exists_but_clean() {
    assert!(settled_candidate_is_deletable(0, true, false));
}

#[test]
fn kept_when_running_or_pending_permission() {
    assert!(!settled_candidate_is_deletable(0, false, true));
}

#[test]
fn deleted_when_no_changes_and_safe() {
    assert!(settled_candidate_is_deletable(0, false, false));
}
