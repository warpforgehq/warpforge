//! Project runtime: services, port-forwards, terminal screens and the
//! configuration options a project exposes.

use crate::ProjectInfo;
use serde::{Deserialize, Serialize};

/// How a project's port range was resolved.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortRangeSource {
    /// Fresh scan from 4000 upward for a free block.
    #[default]
    Auto,
    /// Sticky auto-assignment kept from an earlier resolution.
    Sticky,
    /// Declared in the project's shared config (`ports.range`).
    Declared,
    /// Local registry override (`portRangeOverride`).
    LocalOverride,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfigState {
    pub project: ProjectInfo,
    pub services: Vec<ServiceInfo>,
    pub portforwards: Vec<PortForwardInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub project: String,
    pub name: String,
    pub command: String,
    pub status: ServiceStatus,
    pub original_port: u16,
    pub allocated_port: u16,
    /// True when the service's declared port is a hard pin, not a hint.
    #[serde(default)]
    pub port_pinned: bool,
    /// Sequence number of the newest retained log line.
    pub log_seq: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardInfo {
    pub project: String,
    pub name: String,
    pub namespace: String,
    pub pod: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub status: PortForwardStatus,
    pub log_seq: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortForwardStatus {
    Starting,
    Active,
    Restarting,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub project: String,
    pub command: String,
    pub started_at: u64,
    pub cols: u16,
    pub rows: u16,
}

/// A rendered vt100 screen. Row-oriented so clients don't need a terminal
/// emulator: the daemon owns the single authoritative vt100 parser.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScreen {
    pub cols: u16,
    pub rows: u16,
    pub cursor: (u16, u16),
    /// One entry per row; each row is a run-length list of styled spans.
    pub rows_content: Vec<Vec<StyledSpan>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StyledSpan {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inverse: bool,
}

/// A session-level selector the agent exposes (ACP `configOptions`): model,
/// mode, reasoning effort, etc. We surface it read-only for now.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    /// "mode" | "model" | "model_config" | "thought_level" | …
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub current_value: String,
    pub options: Vec<ConfigChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChoice {
    pub value: String,
    pub name: String,
}
