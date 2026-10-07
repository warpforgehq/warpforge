//! The actor's side of `render_html`: the page is already on disk, and this
//! records it in the task's transcript (ADR 0025).

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;

impl Daemon {
    /// Add a published page to a task's transcript, where it is persisted
    /// and replayed with the rest of the history.
    pub(crate) fn html_render_publish(
        &mut self,
        task_id: &str,
        render_id: String,
        title: String,
        height: u32,
    ) -> Result<(), String> {
        if !self.tasks.contains_key(task_id) {
            return Err(format!("no task '{task_id}'"));
        }
        self.emit_session(
            task_id,
            wire::SessionUpdate::HtmlRender {
                render_id,
                title,
                height,
            },
        );
        Ok(())
    }
}
