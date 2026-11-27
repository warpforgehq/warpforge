use std::fs;
use std::path::{Component, Path, PathBuf};

use warpforge_protocol::{SpaceMember, SpaceMemberKey};

use super::{
    matches_member,
    snapshot::{logical_path, readable_directory},
    Spaces,
};
use crate::registry::ProjectEntry;

impl Spaces {
    /// Merge declarations into the local space, preserving existing folder spellings and names.
    pub(crate) fn merge_linked(
        &mut self,
        project: &ProjectEntry,
        links: &[PathBuf],
        projects: &[ProjectEntry],
    ) -> bool {
        if links.is_empty() {
            return false;
        }
        let (id, mut changed) = match self.for_project(&project.name) {
            Some(space) => (space.id.clone(), false),
            None => {
                let Ok(space) = self.create(project.name.clone()) else {
                    return false;
                };
                space.members.push(SpaceMember::Project {
                    name: project.name.clone(),
                });
                (space.id.clone(), true)
            }
        };
        let root = Path::new(&project.path);
        for link in links {
            if matches!(
                link.components().next(),
                Some(Component::RootDir | Component::Prefix(_))
            ) {
                eprintln!(
                    "[spaces] {}: linked path must be relative: {}",
                    project.name,
                    link.display()
                );
                continue;
            }
            let path = root.join(link);
            let real = match readable_directory(&path) {
                Ok(real) => real,
                Err(err) => {
                    eprintln!(
                        "[spaces] {}: skipping linked folder {}: {err}",
                        project.name,
                        path.display()
                    );
                    continue;
                }
            };
            let index = self.index(&id).expect("space created above");
            let member = if let Some(sibling) = registered_at(projects, &real) {
                if self
                    .for_project(&sibling.name)
                    .is_some_and(|space| space.id == id)
                {
                    continue;
                }
                SpaceMember::Project {
                    name: sibling.name.clone(),
                }
            } else {
                let path = logical_path(&path, &real);
                let Some(value) = path.to_str() else {
                    eprintln!(
                        "[spaces] {}: skipping non-UTF-8 linked folder {}",
                        project.name,
                        path.display()
                    );
                    continue;
                };
                let key = SpaceMemberKey::Folder {
                    path: value.to_owned(),
                };
                if self.spaces[index]
                    .members
                    .iter()
                    .any(|member| matches_member(member, &key))
                {
                    continue;
                }
                SpaceMember::Folder {
                    path: value.to_owned(),
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                }
            };
            match self.add_member(&id, member, projects) {
                Ok(_) => changed = true,
                Err(err) => eprintln!("[spaces] {}: {err}", project.name),
            }
        }
        changed
    }
}

pub(super) fn registered_at<'a>(
    projects: &'a [ProjectEntry],
    real: &Path,
) -> Option<&'a ProjectEntry> {
    projects.iter().find(|project| {
        Path::new(&project.path) == real
            || fs::canonicalize(&project.path).is_ok_and(|path| path == real)
    })
}
