//! The Explorer's lazy file tree (ADR 0028).

mod dir_list;
mod ignore;

pub(crate) use dir_list::dir_list;
pub(crate) use ignore::{Class, IgnoreStack};
