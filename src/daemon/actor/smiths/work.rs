//! Work sessions (ADR 0027): ordinary board tasks that run as a Smith — never
//! children of its thread (invariant 5), in a project it is allowed in.
//! `start_work` from a Smith's session adds the daemon's limits.

use warpforge_protocol as wire;

use super::SMITH_ORIGIN;
use crate::daemon::accounts::SpawnAccount;
use crate::daemon::actor::{Command, Daemon};
use crate::daemon::task::TaskStatus;

/// How many `start_work` hops may lead to a session that starts more.
pub(crate) const MAX_START_DEPTH: u8 = 2;
/// Open work sessions per Smith that `start_work` allows.
pub(crate) const MAX_OPEN_WORK: usize = 3;

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

    /// `start_work` from a Smith's own session: a work session as `target`
    /// ("self" or a Smith's name or id), within the daemon's limits — depth,
    /// open sessions, allowed projects, holds, the target's budget and its
    /// account's quota. The new session reports back to the caller once.
    /// @param from the calling task
    /// @param target who does the work
    /// @param project where
    /// @param brief the assignment
    /// @param backlog_item_id the board item it works on, if any
    /// @param worktree whether it gets its own worktree
    /// @returns the new task's id and the Smith's name
    pub(super) async fn smith_start_work_from(
        &mut self,
        from: &str,
        target: &str,
        project: &str,
        brief: String,
        backlog_item_id: Option<String>,
        worktree: bool,
    ) -> Result<(String, String), String> {
        let caller = self
            .tasks
            .get(from)
            .and_then(|task| task.smith.clone())
            .ok_or("start_work is for a Smith's own sessions")?;
        if caller.depth >= MAX_START_DEPTH {
            return Err(format!(
                "a session started {MAX_START_DEPTH} start_work hops down cannot start more"
            ));
        }
        let smith = self.smith_resolve(target, &caller.smith_id)?;
        if smith.held.contains(&wire::SmithHold::Budget) {
            return Err(format!("{} is over its budget", smith.name));
        }
        if let Some(refusal) = self.smith_budget_refusal(&smith) {
            return Err(format!("{}: {refusal}", smith.name));
        }
        let open = self
            .tasks
            .values()
            .filter(|task| task.origin.as_deref() != Some(SMITH_ORIGIN))
            .filter(|task| task.smith.as_ref().is_some_and(|r| r.smith_id == smith.id))
            .filter(|task| task.status != TaskStatus::Done && task.settled_override != Some(true))
            .count();
        if open >= MAX_OPEN_WORK {
            return Err(format!(
                "{} already has {open} open work sessions; the limit is {MAX_OPEN_WORK}",
                smith.name
            ));
        }
        let account = match smith.account_id.as_deref() {
            Some(id) => SpawnAccount::Pinned(id),
            None => SpawnAccount::Active,
        };
        if let Some(refusal) = self.dispatch_refusal(&smith.agent, account) {
            return Err(refusal);
        }
        let task_id = self
            .smith_start_work(&smith.id, project, brief, backlog_item_id, worktree)
            .await?;
        if let Some(record) = self
            .tasks
            .get_mut(&task_id)
            .and_then(|task| task.smith.as_mut())
        {
            record.depth = caller.depth + 1;
            record.report_to = Some(from.to_string());
        }
        if let Some(updated) = self.tasks.get(&task_id).cloned() {
            self.persist(&updated);
        }
        Ok((task_id, smith.name))
    }

    /// "self", a Smith's id, or its name, ignoring case.
    fn smith_resolve(&self, target: &str, own: &str) -> Result<wire::Smith, String> {
        let id = if target.eq_ignore_ascii_case("self") {
            own
        } else {
            target
        };
        self.smiths
            .smiths
            .get(id)
            .or_else(|| {
                self.smiths
                    .smiths
                    .values()
                    .find(|smith| smith.name.eq_ignore_ascii_case(target))
            })
            .cloned()
            .ok_or_else(|| format!("no Smith is called {target}"))
    }
}
