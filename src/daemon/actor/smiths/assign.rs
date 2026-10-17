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
}
