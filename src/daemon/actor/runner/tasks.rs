//! Creating Factory tasks. The task exists, queued, from the moment a person
//! asks, so it shows in the sidebar while the project's limits hold it; the
//! pipeline starts on that same task when a slot frees.

use std::collections::HashMap;

use warpforge_protocol as wire;

use super::now_secs;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::runner::{self as logic, next_position, RUNNER_TAG};
use crate::daemon::task::{derive_title, Task, TaskStatus};

/// One Factory task to create.
#[derive(Debug, Default)]
pub struct NewFactoryTask {
    pub project: String,
    /// What the task works on, without the Factory preamble.
    pub prompt: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub workflow: Option<String>,
    pub item_id: Option<String>,
    pub run_location: wire::EntryRunLocation,
    pub deliver: bool,
    pub config_overrides: HashMap<String, String>,
    pub include_runtime_context: bool,
    pub attachments: Vec<wire::PromptAttachment>,
    /// The person's own tags; the Factory adds its own.
    pub tags: Vec<String>,
    /// The session asking, when an agent asks.
    pub origin_task: Option<String>,
}

impl Daemon {
    /// Refuse a request from inside a Factory run, so a run can never fill
    /// the queue it is draining (ADR 0023 invariant 2).
    pub(super) fn runner_refuse_origin(&self, origin_task: Option<&str>) -> Result<(), String> {
        let Some(task_id) = origin_task else {
            return Ok(());
        };
        let mut current = self.tasks.get(task_id);
        while let Some(task) = current {
            if task.tags.iter().any(|t| t == RUNNER_TAG) {
                return Err("a Factory run cannot start Factory tasks".to_string());
            }
            current = task
                .parent_task_id
                .as_deref()
                .and_then(|p| self.tasks.get(p));
        }
        Ok(())
    }

    /// The workflow, lead agent and model a new task runs with: its own
    /// choice, else the project's defaults. Refuses a workflow that cannot load.
    fn runner_resolve(
        &self,
        project: &str,
        workflow: Option<&str>,
        agent: Option<&str>,
        model: Option<&str>,
    ) -> Result<(String, String, Option<String>), String> {
        let path = self
            .project_path(project)
            .ok_or_else(|| format!("unknown project '{project}'"))?;
        let settings = self.runner_settings(project);
        let workflow = workflow
            .map(str::trim)
            .filter(|w| !w.is_empty())
            .unwrap_or(&settings.workflow)
            .to_string();
        crate::workflow_config::load_workflow(std::path::Path::new(&path), &workflow)
            .ok_or_else(|| format!("unknown workflow `{workflow}`"))?
            .spec
            .map_err(|e| format!("workflow `{workflow}` is invalid: {e}"))?;
        let (agent, model) = self.runner_lead(project, agent, model);
        if agent.is_empty() {
            return Err("no agent is set up".to_string());
        }
        Ok((workflow, agent, model))
    }

    /// The Factory task already working on `item_id`, if any.
    pub(super) fn runner_task_of_item(&self, item_id: &str) -> Option<String> {
        self.runner
            .entries
            .values()
            .find(|e| e.item_id.as_deref() == Some(item_id))
            .map(|e| e.task_id.clone())
    }

    /// Create the queued task and its entry; nothing starts here.
    /// @returns the new task's id
    pub(super) fn runner_add_task(
        &mut self,
        new: NewFactoryTask,
        item: Option<&wire::BacklogItem>,
    ) -> Result<String, String> {
        let (workflow, agent, model) = self.runner_resolve(
            &new.project,
            new.workflow.as_deref(),
            new.agent.as_deref(),
            new.model.as_deref(),
        )?;
        let prompt = if new.deliver {
            logic::with_preamble(&new.prompt)
        } else {
            new.prompt.trim().to_string()
        };
        let mut tags = new.tags;
        tags.retain(|t| t != RUNNER_TAG && !t.starts_with("workflow:"));
        tags.push(RUNNER_TAG.to_string());
        tags.push(format!("workflow:{workflow}"));
        let mut task = Task::new(&new.project, &prompt, &agent, tags);
        task.write_limit = self.inherited_write_limit(new.origin_task.as_deref());
        task.title = match item {
            Some(item) => item.title.trim().to_string(),
            None => derive_title(&new.prompt),
        };
        task.backlog_item_id = new.item_id.clone();
        task.model = model;
        let task_id = task.id.clone();
        self.tasks.insert(task_id.clone(), task.clone());
        self.persist(&task);
        self.emit(Event::TaskCreated(task.clone()));
        let entry = wire::RunnerEntry {
            task_id: task_id.clone(),
            item_id: new.item_id,
            project: new.project.clone(),
            number: item.map(|i| i.number).unwrap_or_default(),
            title: task.title.clone(),
            priority: item.map(|i| i.priority.clone()).unwrap_or_default(),
            position: next_position(self.runner.entries.values(), &new.project),
            enqueued_at: now_secs(),
            state: wire::RunnerEntryState::Queued,
            workflow: Some(workflow),
            agent: Some(agent),
            model: task.model,
            run_location: new.run_location,
            deliver: new.deliver,
            config_overrides: new.config_overrides,
            include_runtime_context: new.include_runtime_context,
            attachments: new.attachments,
            resolved_location: None,
            run_id: None,
            pr_url: None,
            pr_number: None,
            wait: None,
            updated_at: 0,
        };
        self.runner_put_entry(entry);
        Ok(task_id)
    }

    /// Whether `task_id` left the queue, or is on its way out of it.
    fn runner_started(&self, task_id: &str) -> bool {
        let preparing = self
            .runner
            .leases
            .values()
            .any(|l| l.task_id == task_id && l.state == wire::CheckoutLeaseState::Preparing);
        preparing || !self.runner_is_queued(task_id)
    }

    /// One Factory task per backlog item, with one shared configuration.
    pub(super) async fn runner_enqueue(
        &mut self,
        project: &str,
        item_ids: &[String],
        config: wire::FactoryConfig,
        origin_task: Option<&str>,
    ) -> Result<wire::EnqueueResult, String> {
        self.runner_require_project(project)?;
        self.runner_refuse_origin(origin_task)?;
        if item_ids.is_empty() {
            return Err("no backlog items given".to_string());
        }
        self.runner_resolve(
            project,
            config.workflow.as_deref(),
            config.agent.as_deref(),
            config.model.as_deref(),
        )?;
        let mut created = Vec::new();
        let mut skipped = Vec::new();
        for item_id in item_ids {
            let skip = |number: u64, reason: wire::SkipReason| wire::SkippedItem {
                item_id: item_id.clone(),
                number,
                reason,
            };
            let item = match self.runner_read_item(project, item_id) {
                Ok(Some(item)) => item,
                Ok(None) => {
                    skipped.push(skip(0, wire::SkipReason::NotFound));
                    continue;
                }
                Err(error) => {
                    let detail = format!("{error:#}");
                    skipped.push(skip(0, wire::SkipReason::Unreadable { detail }));
                    continue;
                }
            };
            if let Some(task_id) = self.runner_task_of_item(item_id) {
                let reason = wire::SkipReason::AlreadyInFactory {
                    task_id: Some(task_id),
                };
                skipped.push(skip(item.number, reason));
                continue;
            }
            if matches!(item.status.as_str(), "done" | "cancelled") {
                let reason = wire::SkipReason::Closed {
                    status: item.status.clone(),
                };
                skipped.push(skip(item.number, reason));
                continue;
            }
            let new = NewFactoryTask {
                project: project.to_string(),
                prompt: logic::brief_body(&item),
                agent: config.agent.clone(),
                model: config.model.clone(),
                workflow: config.workflow.clone(),
                item_id: Some(item.id.clone()),
                run_location: config.run_location,
                deliver: config.deliver,
                origin_task: origin_task.map(str::to_string),
                ..NewFactoryTask::default()
            };
            match self.runner_add_task(new, Some(&item)) {
                Ok(task_id) => created.push(task_id),
                Err(detail) => {
                    skipped.push(skip(item.number, wire::SkipReason::Unreadable { detail }))
                }
            }
        }
        self.runner.checkout_blocks.remove(project);
        self.runner_dispatch(project).await;
        self.runner_emit(project);
        let created = created
            .into_iter()
            .map(|task_id| wire::CreatedFactoryTask {
                item_id: self
                    .tasks
                    .get(&task_id)
                    .and_then(|t| t.backlog_item_id.clone()),
                started: self.runner_started(&task_id),
                task_id,
            })
            .collect();
        Ok(wire::EnqueueResult {
            created,
            skipped,
            status: self.runner_status(project),
        })
    }

    /// A Factory task from the New Task dialog: the person's own prompt.
    pub(super) async fn runner_create_from_dialog(
        &mut self,
        new: NewFactoryTask,
    ) -> Result<wire::CreatedFactoryTask, String> {
        let project = new.project.clone();
        self.runner_require_project(&project)?;
        self.runner_refuse_origin(new.origin_task.as_deref())?;
        let item = match new.item_id.as_deref() {
            Some(item_id) => {
                if self.runner_task_of_item(item_id).is_some() {
                    return Err("this backlog item already has a Factory task".to_string());
                }
                let item = self
                    .runner_read_item(&project, item_id)
                    .map_err(|e| format!("{e:#}"))?;
                if let Some(closed) = item
                    .as_ref()
                    .filter(|i| matches!(i.status.as_str(), "done" | "cancelled"))
                {
                    return Err(format!("#{} is already {}", closed.number, closed.status));
                }
                item
            }
            None => None,
        };
        let task_id = self.runner_add_task(new, item.as_ref())?;
        self.runner.checkout_blocks.remove(&project);
        self.runner_dispatch(&project).await;
        self.runner_emit(&project);
        Ok(wire::CreatedFactoryTask {
            item_id: item.map(|i| i.id),
            started: self.runner_started(&task_id),
            task_id,
        })
    }

    /// Drop a queued entry and delete its task, which never ran.
    pub(super) fn runner_discard_queued(&mut self, task_id: &str) {
        self.runner_drop_entry(task_id);
        let cmd_tx = self.cmd_tx.clone();
        let id = task_id.to_string();
        tokio::spawn(async move {
            let (reply, _) = tokio::sync::oneshot::channel();
            let _ = cmd_tx.send(Command::DeleteTask { id, reply }).await;
        });
    }

    /// Mark a Factory task that could not start, so it offers Run again.
    pub(super) fn runner_block_task(&mut self, task_id: &str, reason: String) {
        let Some(task) = self.tasks.get_mut(task_id) else {
            return;
        };
        if task.status != TaskStatus::Queued {
            return;
        }
        task.blocked_reason = Some(reason);
        task.set_status(TaskStatus::Blocked);
        let updated = task.clone();
        self.persist(&updated);
        self.emit(Event::TaskUpdated(updated));
    }
}
