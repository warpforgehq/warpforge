//! The Explorer's lazy file tree (ADR 0028).

mod batch;
mod dir_list;
mod ignore;
mod status;
mod watch;

pub(crate) use dir_list::{dir_list, dir_list_with};
pub(crate) use ignore::{Class, IgnoreStack};
pub(crate) use status::TrackedIgnored;
pub(crate) use watch::{registry, Lease};

/// A root's matcher, shared by its watcher and the `dir.list` calls under it.
pub(crate) type SharedStack = std::sync::Arc<std::sync::Mutex<IgnoreStack>>;

/// Per-root Explorer state shared by every connection; hangs off
/// `DaemonHandle`, outside the actor (ADR 0028).
#[derive(Default)]
pub(crate) struct Explorer {
    pub(crate) status: status::StatusRuns,
}
