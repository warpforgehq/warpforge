//! Wire types for the warpforge daemon API.
//!
//! Transport: WebSocket on 127.0.0.1 (endpoint + auth token published in
//! `~/.warpforge/daemon.json`). Every frame is a JSON object in one of three
//! shapes:
//!
//! - client → daemon  request:  `{ "id": 7, "method": "task.create", "params": { … } }`
//! - daemon → client  response: `{ "id": 7, "result": { … } }` or `{ "id": 7, "error": { … } }`
//! - daemon → client  event:    `{ "event": "service.log", "data": { … } }`
//!
//! Events are broadcast to every subscribed client — the daemon has no concept
//! of a "primary" UI. Clients call `state.subscribe` once after connecting and
//! receive a full [`Snapshot`] followed by incremental events.
//!
//! This crate is deliberately dependency-light (serde only) so the TUI, the
//! Tauri shell's Rust side, and any future client can share it without pulling
//! in daemon internals.

use serde::{Deserialize, Serialize};

pub mod agents;
pub use agents::*;

pub mod automations;
pub use automations::*;

pub mod backlog;
pub use backlog::*;

pub mod event;
pub use event::*;

pub mod git;
pub use git::*;

pub mod method;
pub use method::*;

pub mod project;
pub use project::*;

pub mod pulls;
pub use pulls::*;

pub mod runtime;
pub use runtime::*;

pub mod tasks;
pub use tasks::*;

pub mod tracker;
pub use tracker::*;

pub mod workflow;
pub use workflow::*;

#[cfg(test)]
mod tests;

/// Version of the daemon WebSocket contract. Bump this only for a breaking
/// wire change; application versions may advance without changing it.
pub const PROTOCOL_VERSION: u32 = 1;

pub(crate) fn default_true() -> bool {
    true
}

/// A client → daemon frame.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub method: Method,
}

/// A daemon → client frame.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
// Events intentionally stay inline: this is the shared wire envelope and
// boxing only one variant would leak an allocation detail into every client.
#[allow(clippy::large_enum_variant)]
pub enum ServerMessage {
    Response { id: u64, result: serde_json::Value },
    Error { id: u64, error: RpcError },
    Event(Event),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    NotFound,
    Conflict,
    AgentUnavailable,
    Internal,
    Updating,
}
