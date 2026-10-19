//! A work session that `start_work` started reports every finished turn to
//! the task that asked (ADR 0027 invariant 14), the way a spawned child
//! reports to its orchestrator: an idle asker is woken, a busy one hears it
//! once its turn ends.

use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::peers::MAX_TEXT_CHARS;
use crate::daemon::actor::{Command, Daemon};

impl Daemon {
    /// @param task_id a task
    /// @returns whether its finished turns are reported to an asker
    pub(crate) fn smith_reports_turns(&self, task_id: &str) -> bool {
        self.tasks
            .get(task_id)
            .and_then(|task| task.smith.as_ref())
            .is_some_and(|record| record.report_to.is_some())
    }

    /// A peer message was accepted from `from` to `to`: when `to` is the
    /// asker of `from`'s `start_work`, this turn has already reported.
    /// @param from the sending task
    /// @param to the receiving task
    pub(crate) fn smith_note_message(&mut self, from: &str, to: &str) {
        let asks = self
            .tasks
            .get(from)
            .and_then(|task| task.smith.as_ref())
            .is_some_and(|record| record.report_to.as_deref() == Some(to));
        if asks {
            self.smiths.messaged_asker.insert(from.to_string());
        }
    }

    /// A turn started: what the last one sent its asker no longer counts.
    /// @param task_id the task whose turn started
    pub(crate) fn smith_report_turn_started(&mut self, task_id: &str) {
        self.smiths.messaged_asker.remove(task_id);
    }

    /// Report a finished turn to the asker: a message from the session, held
    /// for the asker's next prompt, and a prompt that is that next one — so
    /// the report arrives through the digest on every harness and asker kind.
    /// @param task_id the work session whose turn ended
    /// @param success whether the turn ended cleanly
    /// @param output the turn's whole text, when it left no closing message
    pub(crate) async fn smith_report_turn(&mut self, task_id: &str, success: bool, output: String) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let Some(asker) = task.smith.as_ref().and_then(|r| r.report_to.clone()) else {
            return;
        };
        if !self.tasks.contains_key(&asker) {
            return;
        }
        // It already told the asker itself this turn; a report would say it twice.
        if self.smiths.messaged_asker.remove(task_id) {
            return;
        }
        let (title, files) = (task.title.clone(), task.files_changed);
        let outcome = if success {
            "finished a turn"
        } else {
            "stopped: its agent disconnected"
        };
        let mut report =
            format!("Work session \"{title}\" ({task_id}) {outcome}; {files} files changed.");
        let closing = self.collect_stage_text(task_id).closing;
        let message = match closing.trim() {
            "" => output.trim().to_string(),
            closing => closing.to_string(),
        };
        if !message.is_empty() {
            report.push_str("\nIts final message:\n");
            let room = MAX_TEXT_CHARS.saturating_sub(report.chars().count() + 1);
            let clipped: String = message.chars().take(room).collect();
            let more = if clipped.len() < message.len() {
                "…"
            } else {
                ""
            };
            report.push_str(&format!("{clipped}{more}"));
        }
        if self.peers_daemon_message(task_id, &asker, report).is_none() {
            return;
        }
        let nudge = format!(
            "[System] Work session \"{title}\" ({task_id}) reported back; its report is in \
             the peer messages above. Decide what to do next."
        );
        let (tx, _rx) = tokio::sync::oneshot::channel();
        self.handle_session_command(Command::SessionPrompt {
            task_id: asker,
            text: nudge,
            attachments: Vec::new(),
            initiator: TurnInitiator::System,
            peer_message: None,
            reply: tx,
        })
        .await;
    }
}
