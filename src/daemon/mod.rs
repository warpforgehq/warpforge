//! The warpforge daemon: the source of truth for all runtime state, driven by
//! commands and emitting events. See [`actor`] for the boundary rationale.
//!
//! Parts of this API surface are consumed only by tests today; the blanket
//! allow keeps the build clean for those.
#![allow(dead_code)]

pub mod accounts;
pub mod acp;
pub mod acp_server;
pub mod actor;
pub mod agent_probe;
pub mod agents;
pub mod attachment;
pub mod automations;
pub mod backlog;
pub mod claude_auth;
pub mod credential_capture;
pub mod diff;
pub mod handoff;
pub mod history_config;
pub mod limits;
pub mod lsp;
pub mod lsp_servers;
pub mod memory;
pub mod memory_config;
pub mod memory_dream;
pub mod memory_embed;
pub mod memory_types;
pub mod prompt;
pub mod runtime;
pub mod search;
pub mod server;
pub mod sessions;
pub mod spend;
pub mod store;
pub mod task;
pub mod tracker;
pub mod wire;
pub mod workflow;
pub mod worktree;

#[allow(unused_imports)]
pub use actor::{Command, Daemon, DaemonHandle, Event};
#[allow(unused_imports)]
pub use store::Store;
#[allow(unused_imports)]
pub use task::{Task, TaskStatus};

#[cfg(test)]
mod tests;
