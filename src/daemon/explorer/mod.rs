//! The Explorer's lazy file tree (ADR 0028).

mod dir_list;
mod ignore;
mod status;

pub(crate) use dir_list::dir_list;
pub(crate) use ignore::{Class, IgnoreStack};
pub(crate) use status::TrackedIgnored;

/// Per-root Explorer state shared by every connection; hangs off
/// `DaemonHandle`, outside the actor (ADR 0028).
#[derive(Default)]
pub(crate) struct Explorer {
    pub(crate) status: status::StatusRuns,
}
