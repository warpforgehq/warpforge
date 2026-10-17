//! Board items assigned to a Smith (ADR 0027): the assignee is `smith:<id>`,
//! on local items only (invariant 13), and assigning starts nothing
//! (invariant 12).

use crate::daemon::actor::Daemon;

/// The assignee prefix that names a Smith by id.
pub(crate) const SMITH_ASSIGNEE: &str = "smith:";

impl Daemon {
    /// Why an item may not take `assignee`.
    /// @param source the item's source: `local`, or the tracker it came from
    /// @param project the item's project
    /// @param assignee the assignee being set
    /// @returns the refusal, for a Smith assignee that does not fit
    pub(crate) fn smith_assignee_refusal(
        &self,
        source: &str,
        project: &str,
        assignee: Option<&str>,
    ) -> Option<String> {
        let id = assignee?.strip_prefix(SMITH_ASSIGNEE)?;
        let Some(smith) = self.smiths.smiths.get(id) else {
            return Some(format!("no Smith has the id {id}"));
        };
        if source != "local" {
            return Some(format!(
                "only local items take a Smith assignee: the next {source} sync would overwrite it"
            ));
        }
        if !smith.allowed_projects.iter().any(|p| p == project) {
            return Some(format!("{} may not work in {project}", smith.name));
        }
        None
    }

    /// The YAML-backed half of taking a deleted Smith off local items: the
    /// SQLite rows go through the store queue, these files off the loop.
    /// @param assignee the Smith's `smith:<id>`
    pub(crate) fn smith_clear_yaml_assignees(&self, assignee: String) {
        let projects: Vec<(String, String)> = self
            .projects
            .iter()
            .filter_map(|p| Some((p.name.clone(), self.project_path(&p.name)?)))
            .collect();
        let store = self.store.clone();
        tokio::spawn(async move {
            let yaml = crate::daemon::runtime::store_read(store, |store| {
                store.backlog_storage_mode().ok()
                    == Some(warpforge_protocol::BacklogStorageMode::Yaml)
            })
            .await
            .unwrap_or(false);
            if !yaml {
                return;
            }
            let _ = tokio::task::spawn_blocking(move || {
                for (project, path) in projects {
                    let items = crate::daemon::backlog::list(&path, &project).unwrap_or_default();
                    for mut item in items {
                        if item.source == "local" && item.assignee.as_deref() == Some(&assignee) {
                            item.assignee = None;
                            if let Err(error) = crate::daemon::backlog::write(&path, &item) {
                                eprintln!("[daemon] clearing {assignee} on {}: {error:#}", item.id);
                            }
                        }
                    }
                }
            })
            .await;
        });
    }
}
