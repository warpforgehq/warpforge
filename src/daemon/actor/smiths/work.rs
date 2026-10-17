//! Work sessions (ADR 0027): ordinary board tasks that run as a Smith — never
//! children of its thread (invariant 5), in a project it is allowed in.

use warpforge_protocol as wire;

use crate::daemon::actor::{Command, Daemon};

impl Daemon {
    /// Start a work session as `id`, from the user's New Task or an assigned
    /// board item.
    /// @param id the Smith
    /// @param project where the work happens
    /// @param brief the assignment, the session's opening prompt
    /// @param backlog_item_id the board item it works on, if any
    /// @param worktree whether it gets its own worktree
    /// @returns the new task's id
    pub(super) async fn smith_start_work(
        &mut self,
        id: &str,
        project: &str,
        brief: String,
        backlog_item_id: Option<String>,
        worktree: bool,
    ) -> Result<String, String> {
        let smith = self
            .smiths_get(id)
            .ok_or_else(|| format!("unknown Smith {id}"))?;
        if !smith.allowed_projects.iter().any(|p| p == project) {
            return Err(format!("{} may not work in {project}", smith.name));
        }
        if smith
            .held
            .iter()
            .any(|hold| *hold != wire::SmithHold::Budget)
        {
            return Err(format!("{} is held and starts no sessions", smith.name));
        }
        if brief.trim().is_empty() {
            return Err("a work session needs a brief".into());
        }
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.handle_task_command(Command::CreateTask {
            project: project.to_string(),
            prompt: brief,
            agent: smith.agent.clone(),
            tags: Vec::new(),
            include_runtime_context: false,
            worktree,
            worktree_base: Default::default(),
            parent_task_id: None,
            attachments: Vec::new(),
            default_model: smith.model.clone(),
            config_overrides: Default::default(),
            backlog_item_id,
            origin: None,
            start: true,
            advisor: None,
            smith_id: Some(smith.id.clone()),
            reply: tx,
        })
        .await;
        rx.try_recv()
            .map_err(|_| "the task was not created".to_string())
    }
}
