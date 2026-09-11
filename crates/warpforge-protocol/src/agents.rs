//! Coding agents and the accounts they run under, plus language servers.

use crate::ConfigOption;
use serde::{Deserialize, Serialize};

/// A user-configured ACP agent (persisted in SQLite, managed via UI).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: String,
    pub display_name: String,
    /// The ACP server command run as `sh -c <acp_command>`.
    pub acp_command: String,
    pub enabled: bool,
    /// Cached model/effort selectors the agent exposed via its last ACP
    /// `session/update` (`configOptions`). Probed once on enable and refreshed
    /// on daemon startup so the New Task view can offer a model picker before
    /// any prompt is sent. Empty when the probe failed or the agent exposes no
    /// model selector.
    #[serde(default)]
    pub models: Vec<ConfigOption>,
    /// Last model the user explicitly picked when starting a task with this
    /// agent. Used as the default for new tasks and for orchestrator-spawned
    /// sub-agents (which have no UI to pick from). `None` until the first
    /// explicit choice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_model: Option<String>,
}

/// An agent candidate surfaced by auto-detection (sent in the setup popup).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAgent {
    pub id: String,
    pub display_name: String,
    pub installed: bool,
    pub default_acp_command: String,
    pub install_hint: String,
    /// Installed version, when it could be determined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Latest published version (from the npm registry), when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    /// Freshness verdict: "current" | "behind" | "missing" | "unknown".
    pub status: String,
    /// Shell command that installs the agent (npm/brew). None when there is no
    /// automatable install (unknown package manager).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_command: Option<String>,
    /// Shell command that updates the agent to latest, derived from how the
    /// existing binary was installed. None when we can't update it safely.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_command: Option<String>,
    /// Whether the daemon can run an automated install/update for this agent.
    pub can_manage: bool,
}

/// One registered login for an agent. Carries only what the switcher shows —
/// credentials never cross this boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    /// Stable id, `"<agent>:<slug>"`.
    pub id: String,
    pub agent_id: String,
    /// User-facing name ("personal", "work"). Editable.
    pub label: String,
    /// Account email, read out of the agent's own credential metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Plan or seat tier, when the agent reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Whether new sessions for this agent use this account.
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLimitWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    pub window_minutes: Option<u64>,
}

/// API-equivalent spend reported by the harness (what the usage *would* cost
/// at API rates), not an amount charged to the user. On a Max/Plus/Team
/// subscription nothing of the sort is billed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpend {
    pub agent_id: String,
    pub today_usd: Option<f64>,
    pub total_usd: Option<f64>,
    pub tasks: u32,
    pub reported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAccountLimits {
    pub account_id: String,
    pub agent_id: String,
    pub label: String,
    pub active: bool,
    pub plan: Option<String>,
    pub windows: Vec<AgentLimitWindow>,
    pub exhausted: bool,
    pub fetched_at: i64,
    pub source: String,
    pub error: Option<String>,
}

/// One supported editor language and its language-server install state, sent
/// by [`Method::LanguageServersDetect`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLanguageServer {
    /// Editor language id, matching the daemon's server_command table
    /// (`typescript`, `rust`, `go`, `python`, `json`, `css`, `html`, `yaml`).
    pub id: String,
    /// User-facing label ("TypeScript / JavaScript", "Rust", …).
    pub language: String,
    pub installed: bool,
    /// Installed version of the server binary, when determinable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Latest published version (from the npm registry), when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    /// Freshness verdict: "current" | "behind" | "missing" | "unknown".
    pub status: String,
    /// Shell command that installs the server. None when there is no automatable
    /// install (unknown package manager / system-only package).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_command: Option<String>,
    /// Shell command that updates an installed server to latest, derived from
    /// how the existing binary was installed. None when it can't be updated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_command: Option<String>,
    /// Whether the daemon can run an automated install/update for this server.
    pub can_manage: bool,
    /// Human-readable install hint shown when the server is missing.
    pub install_hint: String,
}

/// Reply to [`Method::LspStart`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LspStartResult {
    pub server_id: String,
    pub available: bool,
    /// Absolute workspace root the server was rooted at. Clients build
    /// `file://` document URIs from it. Empty when unavailable.
    pub root_path: String,
}
