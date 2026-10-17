//! Who a session can see (ADR 0026, *A directory, one filter*) and the status
//! note each session keeps about itself.

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runner::RUNNER_TAG;
use crate::daemon::task::{derive_title, now_secs, Task, TaskStatus};

const INTERNAL_TAGS: [&str; 4] = ["automation", "dreaming", RUNNER_TAG, "workflow-stage"];
const ORCHESTRATOR_TAG: &str = "orchestrator";
pub(crate) const NOTE_MAX_CHARS: usize = 200;

/// The one visibility filter: every path that lists, messages or digests a
/// peer calls it (ADR 0026 invariant 1).
/// @param task the candidate peer
/// @returns whether other sessions may see and message it
pub(crate) fn is_peer_visible(task: &Task) -> bool {
    task.origin.is_none()
        && task.parent_task_id.is_none()
        && !task
            .tags
            .iter()
            .any(|tag| INTERNAL_TAGS.contains(&tag.as_str()))
        && task.status != TaskStatus::Done
        && task.settled_override != Some(true)
}

/// A visible task's directory entry.
/// @param task the peer
/// @param now unix seconds, for the snooze mark
/// @returns metadata only, never prompt or transcript text beyond the title
pub(crate) fn peer_info(task: &Task, now: u64) -> wire::PeerInfo {
    let title = if task.title.trim().is_empty() {
        derive_title(&task.prompt)
    } else {
        task.title.clone()
    };
    wire::PeerInfo {
        id: task.id.clone(),
        kind: wire::PeerKind::Task,
        name: None,
        title,
        agent: task.agent.clone(),
        model: task.model.clone(),
        status: crate::daemon::wire::task_status(&task.status),
        blocked_kind: task.blocked_kind,
        snoozed: task.snoozed_until.is_some_and(|until| until > now),
        orchestrator: task.tags.iter().any(|tag| tag == ORCHESTRATOR_TAG),
        project: task.project.clone(),
        worktree: task.worktree.clone(),
        base_branch: task.base_branch.clone(),
        files_changed: task.files_changed,
        updated_at: task.updated_at,
        note: task.status_note.clone(),
    }
}

/// Trim a note to the stored length; blank text clears it.
/// @param text what the session said
/// @returns the note to keep
pub(crate) fn clip_note(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.chars().take(NOTE_MAX_CHARS).collect())
}

/// How every surface names the user as a sender.
pub(crate) const USER_LABEL: &str = "the user";

impl Daemon {
    /// @param task_id a sender or receiver; `None` for the user
    /// @returns its `peer_label`, or its id once the task is gone
    pub(crate) fn peers_label(&self, task_id: Option<&str>) -> String {
        match task_id {
            None => USER_LABEL.to_string(),
            Some(id) => self
                .tasks
                .get(id)
                .map(|task| wire::peer_label(&self.peer_entry(task, now_secs())))
                .unwrap_or_else(|| id.to_string()),
        }
    }

    /// A hidden caller sees nobody, since nobody could answer it; a muted
    /// session's note is withheld.
    /// @returns `None` for a hidden caller
    pub(super) fn peers_list(&self, task_id: &str) -> Result<Option<Vec<wire::PeerInfo>>, String> {
        let caller = self
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("unknown task {task_id}"))?;
        if !self.peer_visible(caller, &caller.project) {
            return Ok(None);
        }
        let now = now_secs();
        let mut peers: Vec<wire::PeerInfo> = self
            .tasks
            .values()
            .filter(|task| task.id != caller.id)
            .filter(|task| self.peer_visible(task, &caller.project))
            .map(|task| {
                let mut info = self.peer_entry(task, now);
                if self.peers.muted.contains(&task.id) {
                    info.note = None;
                }
                info
            })
            .collect();
        peers.sort_by_key(|peer| std::cmp::Reverse(peer.updated_at));
        Ok(Some(peers))
    }

    pub(super) fn peers_set_status_note(
        &mut self,
        task_id: &str,
        text: &str,
    ) -> Result<(), String> {
        if self.peers.muted.contains(task_id) {
            return Err(super::MUTED_SELF.into());
        }
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("unknown task {task_id}"))?;
        if !self.peer_visible(task, &task.project) {
            return Err(super::HIDDEN_SELF.into());
        }
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.status_note = clip_note(text);
            // Clients show the note (the Smiths sidebar); nothing is persisted.
            let updated = task.clone();
            self.emit(Event::TaskUpdated(updated));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> Task {
        Task::new("demo", "Fix the login page\nmore detail", "claude", vec![])
    }

    #[test]
    fn a_plain_top_level_task_is_visible() {
        assert!(is_peer_visible(&task()));
        let mut waiting = task();
        waiting.status = TaskStatus::Waiting;
        assert!(is_peer_visible(&waiting));
    }

    #[test]
    fn hidden_child_and_internal_tasks_are_not_visible() {
        let mut hidden = task();
        hidden.origin = Some("pr-review".into());
        let mut child = task();
        child.parent_task_id = Some("t_parent".into());
        assert!(!is_peer_visible(&hidden));
        assert!(!is_peer_visible(&child));
        for tag in INTERNAL_TAGS {
            let mut internal = task();
            internal.tags = vec!["x".into(), tag.into()];
            assert!(!is_peer_visible(&internal), "{tag}");
        }
    }

    #[test]
    fn settled_tasks_are_not_visible() {
        let mut done = task();
        done.status = TaskStatus::Done;
        let mut settled = task();
        settled.settled_override = Some(true);
        let mut unsettled = task();
        unsettled.settled_override = Some(false);
        assert!(!is_peer_visible(&done));
        assert!(!is_peer_visible(&settled));
        assert!(is_peer_visible(&unsettled));
    }

    #[test]
    fn snoozed_and_orchestrator_tasks_are_visible_and_marked() {
        let mut snoozed = task();
        snoozed.snoozed_until = Some(1_000);
        assert!(is_peer_visible(&snoozed));
        assert!(peer_info(&snoozed, 999).snoozed);
        assert!(!peer_info(&snoozed, 1_000).snoozed);

        let mut orchestrator = task();
        orchestrator.tags = vec!["orchestrator".into()];
        assert!(is_peer_visible(&orchestrator));
        assert!(peer_info(&orchestrator, 0).orchestrator);
    }

    #[test]
    fn the_entry_falls_back_to_the_prompt_line_and_has_no_name() {
        let mut untitled = task();
        untitled.title = String::new();
        let info = peer_info(&untitled, 0);
        assert_eq!(info.title, "Fix the login page");
        assert_eq!(info.name, None);
        assert_eq!(wire::peer_label(&info), "Fix the login page");
    }

    #[test]
    fn notes_are_trimmed_clipped_and_cleared_by_blank_text() {
        assert_eq!(
            clip_note("  reviewing auth  ").as_deref(),
            Some("reviewing auth")
        );
        assert_eq!(clip_note(" \n "), None);
        let long = "ж".repeat(NOTE_MAX_CHARS + 50);
        assert_eq!(clip_note(&long).unwrap().chars().count(), NOTE_MAX_CHARS);
    }
}
