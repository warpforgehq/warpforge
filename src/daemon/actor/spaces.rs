use std::path::{Path, PathBuf};

use tokio::sync::oneshot;
use warpforge_protocol::{ErrorCode, RpcError, Space, SpaceMember, SpaceMemberKey};

use crate::daemon::spaces::Spaces;
use crate::daemon::task::Task;

use super::{Daemon, Event};

pub(crate) enum SpaceCommand {
    List(oneshot::Sender<Result<Vec<Space>, RpcError>>),
    Change {
        change: SpaceChange,
        reply: oneshot::Sender<Result<Space, RpcError>>,
    },
}

pub(crate) enum SpaceChange {
    Create(String),
    Rename { id: String, name: String },
    Delete(String),
    AddMember { id: String, member: SpaceMember },
    RemoveMember { id: String, member: SpaceMemberKey },
}

impl Daemon {
    pub(super) fn handle_space_command(&self, command: SpaceCommand) {
        match command {
            SpaceCommand::List(reply) => {
                let _ = reply.send(Spaces::load().map(|store| store.spaces).map_err(internal));
            }
            SpaceCommand::Change { change, reply } => {
                let _ = reply.send(self.change_space(change));
            }
        }
    }

    fn change_space(&self, change: SpaceChange) -> Result<Space, RpcError> {
        let mut store = Spaces::load().map_err(internal)?;
        let changed = match change {
            SpaceChange::Create(name) => store.create(name).map(|space| space.clone()),
            SpaceChange::Rename { id, name } => store.rename(&id, name).cloned(),
            SpaceChange::Delete(id) => store.delete(&id),
            SpaceChange::AddMember { id, member } => {
                store.add_member(&id, member, &self.projects).cloned()
            }
            SpaceChange::RemoveMember { id, member } => store.remove_member(&id, &member).cloned(),
        }
        .map_err(|err| RpcError {
            code: ErrorCode::InvalidRequest,
            message: err.to_string(),
        })?;
        store.save().map_err(internal)?;
        self.emit(Event::SpacesChanged(store.spaces));
        Ok(changed)
    }

    pub(super) fn load_spaces(&self) -> Vec<Space> {
        Spaces::load()
            .map(|store| store.spaces)
            .unwrap_or_else(|err| {
                eprintln!("[spaces] {err:#}");
                Vec::new()
            })
    }

    pub(super) fn load_linked_spaces(&self) {
        self.merge_space_links(self.projects.iter().filter_map(|project| {
            let config = crate::config::load_workspace_config(Path::new(&project.path))?;
            Some((project.name.clone(), config.linked))
        }));
    }

    pub(super) fn merge_space_links(
        &self,
        links: impl IntoIterator<Item = (String, Vec<PathBuf>)>,
    ) {
        let mut links = links
            .into_iter()
            .filter(|(_, paths)| !paths.is_empty())
            .peekable();
        if links.peek().is_none() {
            return;
        }
        let result = (|| -> anyhow::Result<()> {
            let mut store = Spaces::load()?;
            let mut changed = false;
            for (name, paths) in links {
                if let Some(project) = self.projects.iter().find(|project| project.name == name) {
                    changed |= store.merge_linked(project, &paths, &self.projects);
                }
            }
            if changed {
                store.save()?;
                self.emit(Event::SpacesChanged(store.spaces));
            }
            Ok(())
        })();
        if let Err(err) = result {
            eprintln!("[spaces] merging linked folders: {err:#}");
        }
    }

    pub(super) fn new_task(
        &self,
        project: &str,
        prompt: &str,
        agent: &str,
        tags: Vec<String>,
    ) -> Task {
        let mut task = Task::new(project, prompt, agent, tags);
        if let Some(primary) = self.projects.iter().find(|entry| entry.name == project) {
            match Spaces::load() {
                Ok(store) => task.workspace_folders = store.siblings(primary, &self.projects),
                Err(err) => eprintln!("[spaces] {project}: {err:#}"),
            }
        }
        task
    }
}

fn internal(err: anyhow::Error) -> RpcError {
    RpcError {
        code: ErrorCode::Internal,
        message: format!("{err:#}"),
    }
}
