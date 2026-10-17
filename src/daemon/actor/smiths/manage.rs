//! Creating, editing, pausing and deleting Smiths, and resolving an identity
//! edit made outside the daemon. Every identity write runs off the loop.

use tokio::sync::oneshot;

use warpforge_protocol as wire;

use super::{recorded, set_hold, SmithCommand, SMITH_ORIGIN};
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::smiths::identity::{self, Identity, Revs};
use crate::daemon::smiths::{check_charter, check_name, soul_template, CHARTER_TEMPLATE};
use crate::daemon::task::{now_secs, Task, TaskSmith, TaskStatus};

type Reply<T> = oneshot::Sender<Result<T, String>>;

const HELD_FOR_EDIT: &str =
    "its identity files were edited outside Warpforge; accept or revert that edit first";

fn detail(smith: wire::Smith, identity: Identity) -> wire::SmithDetail {
    wire::SmithDetail {
        smith,
        soul: identity.soul,
        charter: identity.charter,
    }
}

impl Daemon {
    fn smith(&self, id: &str) -> Result<&wire::Smith, String> {
        self.smiths
            .smiths
            .get(id)
            .ok_or_else(|| format!("unknown Smith {id}"))
    }

    /// A name no other Smith holds or is being created with, ignoring case.
    fn smith_check_name(&self, name: &str, except: Option<&str>) -> Result<(), String> {
        check_name(name)?;
        let key = name.to_lowercase();
        let taken = self
            .smiths
            .smiths
            .values()
            .any(|s| Some(s.id.as_str()) != except && s.name.to_lowercase() == key);
        if taken || self.smiths.pending_names.contains(&key) {
            return Err(format!("a Smith named {name} already exists"));
        }
        Ok(())
    }

    fn smith_check_projects(&self, projects: &[String]) -> Result<(), String> {
        match projects.iter().find(|p| self.project_path(p).is_none()) {
            Some(unknown) => Err(format!("unknown project {unknown}")),
            None => Ok(()),
        }
    }

    /// Run `work` on the blocking pool and hand its result back as a command.
    fn smith_off_loop(&self, work: impl FnOnce() -> SmithCommand + Send + 'static) {
        let tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            if let Ok(cmd) = tokio::task::spawn_blocking(work).await {
                let _ = tx.send(Command::Smiths(cmd)).await;
            }
        });
    }

    pub(super) fn smith_get(&self, id: &str, reply: Reply<wire::SmithDetail>) {
        let smith = match self.smith(id) {
            Ok(smith) => self.smith_view(smith.clone()),
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        let dir = identity::repo(&self.smiths.root, id);
        tokio::task::spawn_blocking(move || {
            let result = identity::read(&dir)
                .map(|files| detail(smith, files))
                .map_err(|e| format!("{e:#}"));
            let _ = reply.send(result);
        });
    }

    pub(super) fn smith_create(
        &mut self,
        create: wire::SmithCreate,
        reply: Reply<wire::SmithDetail>,
    ) {
        let mut allowed = create.allowed_projects.clone();
        if !allowed.contains(&create.home_project) {
            allowed.insert(0, create.home_project.clone());
        }
        let charter = create
            .charter
            .clone()
            .unwrap_or_else(|| CHARTER_TEMPLATE.to_string());
        let checked = self
            .smith_check_name(&create.name, None)
            .and_then(|()| self.smith_check_projects(&allowed))
            .and_then(|()| check_charter(&charter))
            .and_then(|()| {
                (!create.agent.trim().is_empty())
                    .then_some(())
                    .ok_or_else(|| "a Smith needs an agent".to_string())
            });
        if let Err(error) = checked {
            let _ = reply.send(Err(error));
            return;
        }
        let id = format!("sm_{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let smith = wire::Smith {
            id: id.clone(),
            name: create.name.clone(),
            home_project: create.home_project.clone(),
            allowed_projects: allowed,
            agent: create.agent.clone(),
            model: create.model.clone().filter(|m| !m.is_empty()),
            account_id: create.account_id.clone().filter(|a| !a.is_empty()),
            budget: create.budget.clone().unwrap_or_default(),
            permissions: create.permissions.clone().unwrap_or_default(),
            thread_task_id: String::new(),
            soul_rev: String::new(),
            charter_rev: String::new(),
            held: Vec::new(),
            created_at: now_secs(),
            injection: None,
        };
        self.smiths.pending_names.insert(create.name.to_lowercase());
        let files = Identity {
            soul: create.soul.unwrap_or_else(|| soul_template(&create.name)),
            charter,
        };
        let dir = identity::repo(&self.smiths.root, &id);
        self.smith_off_loop(move || {
            let result = identity::create(&dir, &files)
                .map(|revs| (revs, files))
                .map_err(|e| format!("{e:#}"));
            SmithCommand::Created {
                smith: Box::new(smith),
                result,
                reply,
            }
        });
    }

    /// The repo exists: give the Smith its hidden thread task and publish it.
    pub(super) fn smith_created(
        &mut self,
        mut smith: wire::Smith,
        result: Result<(Revs, Identity), String>,
        reply: Reply<wire::SmithDetail>,
    ) {
        self.smiths.pending_names.remove(&smith.name.to_lowercase());
        let (revs, files) = match result {
            Ok(written) => written,
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        let mut thread = Task::new(
            &smith.home_project,
            &format!("{}'s thread", smith.name),
            &smith.agent,
            vec![format!("smith:{}", smith.id)],
        );
        thread.title = smith.name.clone();
        thread.origin = Some(SMITH_ORIGIN.to_string());
        thread.model = smith.model.clone();
        thread.account_id = smith.account_id.clone();
        thread.smith = Some(TaskSmith::new(&smith.id));
        thread.set_status(TaskStatus::Waiting);
        smith.thread_task_id = thread.id.clone();
        smith.soul_rev = revs.soul;
        smith.charter_rev = revs.charter;
        self.tasks.insert(thread.id.clone(), thread.clone());
        self.persist(&thread);
        self.emit(Event::TaskCreated(thread));
        self.smiths
            .souls
            .insert(smith.id.clone(), files.soul.clone());
        self.smith_put(smith.clone());
        let _ = reply.send(Ok(detail(self.smith_view(smith), files)));
    }

    pub(super) fn smith_update(
        &mut self,
        id: &str,
        patch: wire::SmithPatch,
        reply: Reply<wire::SmithDetail>,
    ) {
        let checked = self.smith_check_patch(id, &patch);
        if let Err(error) = checked {
            let _ = reply.send(Err(error));
            return;
        }
        self.smiths.busy.insert(id.to_string());
        let dir = identity::repo(&self.smiths.root, id);
        let id = id.to_string();
        self.smith_off_loop(move || {
            let result = identity::write(&dir, patch.soul.as_deref(), patch.charter.as_deref())
                .and_then(|revs| Ok((revs, identity::read(&dir)?)))
                .map_err(|e| format!("{e:#}"));
            SmithCommand::IdentityWritten {
                id,
                result,
                patch: Some(Box::new(patch)),
                reply,
            }
        });
    }

    fn smith_check_patch(&self, id: &str, patch: &wire::SmithPatch) -> Result<(), String> {
        let smith = self.smith(id)?;
        if self.smiths.busy.contains(id) {
            return Err(format!("{} is still saving an edit; try again", smith.name));
        }
        let edits_identity = patch.soul.is_some() || patch.charter.is_some();
        if edits_identity && smith.held.contains(&wire::SmithHold::IdentityChanged) {
            return Err(format!("{} cannot be edited: {HELD_FOR_EDIT}", smith.name));
        }
        if let Some(name) = &patch.name {
            self.smith_check_name(name, Some(id))?;
        }
        if let Some(projects) = &patch.allowed_projects {
            self.smith_check_projects(projects)?;
        }
        if let Some(charter) = &patch.charter {
            check_charter(charter)?;
        }
        if patch.agent.as_deref().is_some_and(|a| a.trim().is_empty()) {
            return Err("a Smith needs an agent".into());
        }
        Ok(())
    }

    /// An edit, accept or revert landed on disk: record the revs, apply the
    /// rest of the edit, and lift the identity hold.
    pub(super) fn smith_identity_written(
        &mut self,
        id: &str,
        result: Result<(Revs, Identity), String>,
        patch: Option<wire::SmithPatch>,
        reply: Reply<wire::SmithDetail>,
    ) {
        self.smiths.busy.remove(id);
        let (revs, files) = match result {
            Ok(written) => written,
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        let Some(mut smith) = self.smiths.smiths.get(id).cloned() else {
            let _ = reply.send(Err(format!("unknown Smith {id}")));
            return;
        };
        smith.soul_rev = revs.soul;
        smith.charter_rev = revs.charter;
        self.smiths.souls.insert(id.to_string(), files.soul.clone());
        match patch {
            Some(patch) => apply(&mut smith, patch),
            None => set_hold(&mut smith, wire::SmithHold::IdentityChanged, false),
        }
        self.smith_sync_thread(&smith);
        self.smith_put(smith.clone());
        let _ = reply.send(Ok(detail(self.smith_view(smith), files)));
    }

    /// Carry the Smith's name, agent, model and account onto its thread
    /// task; a running thread session keeps what it started with, and the
    /// next one starts with these.
    fn smith_sync_thread(&mut self, smith: &wire::Smith) {
        let Some(thread) = self.tasks.get_mut(&smith.thread_task_id) else {
            return;
        };
        let same = thread.title == smith.name
            && thread.agent == smith.agent
            && thread.model == smith.model
            && thread.account_id == smith.account_id;
        if same {
            return;
        }
        thread.title = smith.name.clone();
        thread.agent = smith.agent.clone();
        thread.model = smith.model.clone();
        thread.account_id = smith.account_id.clone();
        let updated = thread.clone();
        self.persist(&updated);
        self.emit(Event::TaskUpdated(updated));
    }

    pub(super) fn smith_set_paused(
        &mut self,
        id: &str,
        paused: bool,
    ) -> Result<wire::Smith, String> {
        let mut smith = self.smith(id)?.clone();
        set_hold(&mut smith, wire::SmithHold::Paused, paused);
        self.smith_put(smith.clone());
        Ok(self.smith_view(smith))
    }

    /// Archive the thread, retire the identity repo and take the Smith off
    /// local board items. Its journal and past work sessions stay.
    pub(super) fn smith_delete(&mut self, id: &str) -> Result<(), String> {
        if self.smiths.busy.contains(id) {
            return Err("the Smith is still saving an edit; try again".into());
        }
        let smith = self
            .smiths
            .smiths
            .remove(id)
            .ok_or_else(|| format!("unknown Smith {id}"))?;
        self.smiths.souls.remove(id);
        self.persist
            .write(PersistWrite::DeleteSmith(id.to_string()));
        self.persist
            .write(PersistWrite::ClearBacklogAssignee(format!("smith:{id}")));
        if let Some(handle) = self.drop_session(&smith.thread_task_id) {
            tokio::spawn(async move {
                let _ = handle.cancel_and_wait().await;
            });
        }
        if let Some(thread) = self.tasks.get_mut(&smith.thread_task_id) {
            thread.set_status(TaskStatus::Done);
            let updated = thread.clone();
            self.persist(&updated);
            self.emit(Event::TaskUpdated(updated));
        }
        self.smith_clear_yaml_assignees(format!("smith:{id}"));
        self.channels_drop_smith(id);
        let root = self.smiths.root.clone();
        let id = id.to_string();
        self.emit(Event::SmithRemoved { id: id.clone() });
        tokio::task::spawn_blocking(move || {
            if let Err(error) = identity::retire(&root, &id, now_secs()) {
                eprintln!("[daemon] retiring Smith {id}: {error:#}");
            }
        });
        Ok(())
    }

    pub(super) fn smith_resolve_identity(
        &mut self,
        id: &str,
        keep: bool,
        reply: Reply<wire::SmithDetail>,
    ) {
        let smith = match self.smith(id) {
            Ok(smith) => smith.clone(),
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        if !smith.held.contains(&wire::SmithHold::IdentityChanged) {
            let _ = reply.send(Err(format!(
                "{} has no outside edit to resolve",
                smith.name
            )));
            return;
        }
        if !self.smiths.busy.insert(id.to_string()) {
            let _ = reply.send(Err(format!(
                "{} is still saving an edit; try again",
                smith.name
            )));
            return;
        }
        let dir = identity::repo(&self.smiths.root, id);
        let expected = recorded(&smith);
        let id = id.to_string();
        self.smith_off_loop(move || {
            let written = if keep {
                identity::accept(&dir)
            } else {
                identity::revert(&dir, &expected)
            };
            let result = written
                .and_then(|revs| Ok((revs, identity::read(&dir)?)))
                .map_err(|e| format!("{e:#}"));
            SmithCommand::IdentityWritten {
                id,
                result,
                patch: None,
                reply,
            }
        });
    }
}

/// The non-identity fields of an edit; an empty model or account clears it.
fn apply(smith: &mut wire::Smith, patch: wire::SmithPatch) {
    if let Some(name) = patch.name {
        smith.name = name;
    }
    if let Some(agent) = patch.agent {
        smith.agent = agent;
    }
    if let Some(model) = patch.model {
        smith.model = (!model.is_empty()).then_some(model);
    }
    if let Some(account) = patch.account_id {
        smith.account_id = (!account.is_empty()).then_some(account);
    }
    if let Some(mut projects) = patch.allowed_projects {
        if !projects.contains(&smith.home_project) {
            projects.insert(0, smith.home_project.clone());
        }
        smith.allowed_projects = projects;
    }
    if let Some(permissions) = patch.permissions {
        smith.permissions = permissions;
    }
    if let Some(budget) = patch.budget {
        smith.budget = budget;
    }
}
