use std::fs;
use std::io::{ErrorKind, Write};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use warpforge_protocol::{Space, SpaceMember, SpaceMemberKey};

use crate::registry::{warpforge_dir, ProjectEntry};

mod linked;
mod snapshot;
#[cfg(test)]
mod tests;

pub(crate) use snapshot::{additional_directories, workspace_folders, WorkspaceFolder};

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Spaces {
    pub(crate) spaces: Vec<Space>,
}

impl Spaces {
    pub(crate) fn load() -> Result<Self> {
        match fs::read(warpforge_dir().join("spaces.json")) {
            Ok(data) => serde_json::from_slice(&data).context("parsing spaces.json"),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(err).context("reading spaces.json"),
        }
    }

    pub(crate) fn save(&self) -> Result<()> {
        let dir = warpforge_dir();
        fs::create_dir_all(&dir)?;
        let mut file = tempfile::NamedTempFile::new_in(&dir)?;
        serde_json::to_writer_pretty(&mut file, self)?;
        writeln!(file)?;
        file.as_file().sync_all()?;
        file.persist(dir.join("spaces.json"))?;
        Ok(())
    }

    pub(crate) fn create(&mut self, name: String) -> Result<&mut Space> {
        let name = space_name(name)?;
        self.spaces.push(Space {
            id: Uuid::new_v4().to_string(),
            name,
            members: Vec::new(),
        });
        Ok(self.spaces.last_mut().unwrap())
    }

    pub(crate) fn rename(&mut self, id: &str, name: String) -> Result<&Space> {
        let index = self.index(id)?;
        self.spaces[index].name = space_name(name)?;
        Ok(&self.spaces[index])
    }

    pub(crate) fn delete(&mut self, id: &str) -> Result<Space> {
        Ok(self.spaces.remove(self.index(id)?))
    }

    pub(crate) fn add_member(
        &mut self,
        id: &str,
        mut member: SpaceMember,
        projects: &[ProjectEntry],
    ) -> Result<&Space> {
        let index = self.index(id)?;
        match &mut member {
            SpaceMember::Project { name } => {
                if let Some(space) = self.for_project(name) {
                    bail!(
                        "Project \"{name}\" already belongs to space \"{}\"",
                        space.name
                    );
                }
                let project = projects
                    .iter()
                    .find(|project| project.name == *name)
                    .with_context(|| format!("Project \"{name}\" is not registered"))?;
                let key = SpaceMemberKey::Folder {
                    path: project.path.clone(),
                };
                self.spaces[index]
                    .members
                    .retain(|member| !matches_member(member, &key));
            }
            SpaceMember::Folder { path, .. } => {
                let resolved = snapshot::readable_directory(path.as_ref())?;
                if let Some(project) = linked::registered_at(projects, &resolved) {
                    return self.add_member(
                        id,
                        SpaceMember::Project {
                            name: project.name.clone(),
                        },
                        projects,
                    );
                }
                *path = snapshot::logical_path(path.as_ref(), &resolved)
                    .to_str()
                    .context("folder path must be UTF-8")?
                    .to_owned();
                let key = SpaceMemberKey::Folder { path: path.clone() };
                if self.spaces[index]
                    .members
                    .iter()
                    .any(|member| matches_member(member, &key))
                {
                    bail!("Folder \"{path}\" already belongs to this space");
                }
            }
        }
        self.spaces[index].members.push(member);
        Ok(&self.spaces[index])
    }

    pub(crate) fn remove_member(&mut self, id: &str, key: &SpaceMemberKey) -> Result<&Space> {
        let index = self.index(id)?;
        let space = &mut self.spaces[index];
        let count = space.members.len();
        space.members.retain(|member| !matches_member(member, key));
        if count == space.members.len() {
            bail!("Member is not in space \"{}\"", space.name);
        }
        Ok(space)
    }

    fn index(&self, id: &str) -> Result<usize> {
        self.spaces
            .iter()
            .position(|space| space.id == id)
            .with_context(|| format!("Space \"{id}\" was not found"))
    }

    fn for_project(&self, name: &str) -> Option<&Space> {
        self.spaces.iter().find(|space| {
            space.members.iter().any(|member| {
                matches!(member, SpaceMember::Project { name: member_name } if member_name == name)
            })
        })
    }
}

fn matches_member(member: &SpaceMember, key: &SpaceMemberKey) -> bool {
    match (member, key) {
        (SpaceMember::Project { name }, SpaceMemberKey::Project { name: key }) => name == key,
        (SpaceMember::Folder { path, .. }, SpaceMemberKey::Folder { path: key }) => {
            path == key
                || fs::canonicalize(path)
                    .ok()
                    .is_some_and(|real| fs::canonicalize(key).is_ok_and(|other| other == real))
        }
        _ => false,
    }
}

fn space_name(name: String) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        bail!("A space needs a name");
    }
    Ok(name.to_string())
}
