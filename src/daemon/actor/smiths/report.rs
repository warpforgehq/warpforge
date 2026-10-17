//! A work session that `start_work` started reports back once, when it
//! settles, to the task that asked (ADR 0027 invariant 14).

use crate::daemon::actor::Daemon;
use crate::daemon::task::TaskStatus;

/// The most of the session's closing message a report carries.
const CLOSING_CHARS: usize = 600;

impl Daemon {
    /// Send the settled session's report to the asking task, once: a
    /// message from the session, held for the asker's next prompt.
    /// @param task_id the work session that settled
    pub(crate) fn smith_report_back(&mut self, task_id: &str) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let Some(record) = task.smith.as_ref().filter(|r| !r.reported) else {
            return;
        };
        let Some(asker) = record.report_to.clone() else {
            return;
        };
        let settled = task.status == TaskStatus::Done || task.settled_override == Some(true);
        if !settled {
            return;
        }
        let outcome = match task.status {
            TaskStatus::Blocked => "blocked",
            TaskStatus::Interrupted => "interrupted",
            _ => "finished",
        };
        let mut report = format!(
            "Work session \"{}\" ({}) {outcome}: {} files changed.",
            task.title, task.id, task.files_changed
        );
        let closing = self.collect_stage_text(task_id).closing;
        let closing = closing.trim();
        if !closing.is_empty() {
            let clipped: String = closing.chars().take(CLOSING_CHARS).collect();
            let more = if clipped.len() < closing.len() {
                "…"
            } else {
                ""
            };
            report.push_str(&format!("\nClosing message: {clipped}{more}"));
        }
        if self.peers_daemon_message(task_id, &asker, report).is_none() {
            return;
        }
        if let Some(task) = self.tasks.get_mut(task_id) {
            if let Some(record) = task.smith.as_mut() {
                record.reported = true;
            }
            let updated = task.clone();
            self.persist(&updated);
        }
    }
}
