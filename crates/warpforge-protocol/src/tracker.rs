//! Issue trackers (GitHub / Linear sync): links, statuses, imports and the
//! external work items a project pulls in.

use serde::{Deserialize, Serialize};

/// Mirror of the desktop backlog's normalized statuses; these are the values
/// warpforge uses internally and maps onto each tracker's native states.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemPriority {
    Urgent,
    High,
    Medium,
    Low,
    #[default]
    None,
}

/// A single external-tracker link for a backlog item, as seen by clients.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkInfo {
    /// The warpforge backlog item id (client-generated UUID).
    pub item_id: String,
    /// Provider: "github" or "linear".
    pub provider: String,
    /// Provider-native identifier (GHL-123, #456).
    pub external_id: String,
    pub url: String,
    /// Normalized status last observed remotely.
    #[serde(default)]
    pub status: String,
    /// Provider-native status label, if richer than the normalized one
    /// (GitHub project columns, Linear state names).
    #[serde(default)]
    pub remote_status: Option<String>,
    /// When the remote was last observed, unix seconds. 0 = never synced.
    #[serde(default)]
    pub last_synced_at: u64,
    /// Id of the daemon task this backlog item became, if any.
    #[serde(default)]
    pub task_id: Option<String>,
}

/// Linear connection state (subset of what `tracker.status` returns).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinearStatus {
    pub connected: bool,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
}

/// GitHub connection state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerGithubStatus {
    pub connected: bool,
    #[serde(default)]
    pub login: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    #[serde(default)]
    pub linear: Option<TrackerLinearStatus>,
    #[serde(default)]
    pub github: Option<TrackerGithubStatus>,
}

/// One image from an issue body, already fetched. Inlined as base64 rather
/// than handed over as a URL: the renderer has no tracker session, and a
/// signed storage link expires in minutes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerAttachment {
    /// The image's MIME type, e.g. `image/png`.
    pub content_type: String,
    pub data_base64: String,
}

/// A Linear team the connected API key can see, so the desktop can point a
/// project at one instead of making anyone paste an id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinearTeam {
    pub id: String,
    pub key: String,
    pub name: String,
}

/// Which external-tracker slice a project reads. Currently just the Linear
/// team mapping; GitHub rides on the `gh` CLI session and needs none.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackerProjectSettings {
    pub project: String,
    /// Linear team id this project imports from, or `None` before any choice.
    #[serde(default)]
    pub linear_team_id: Option<String>,
    #[serde(default)]
    pub linear_team_name: Option<String>,
}

/// Per-project tracker availability. This is what the UI should key its
/// source filters and pickers on: the global connection state says nothing
/// about whether *this* project has a repo or a Linear team behind it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSources {
    pub project: String,
    /// Local items are always available.
    pub local: bool,
    /// Linear is usable only with a team mapped for this project.
    pub linear: bool,
    /// GitHub is usable only when the project dir resolves to a repo the
    /// connected `gh` session can see.
    pub github: bool,
}

/// Result of creating an external issue for a backlog item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateExternalResult {
    pub item_id: String,
    pub provider: String,
    pub external_id: String,
    pub url: String,
    pub status: String,
}

/// One synced external item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncedExternalItem {
    pub id: String,
    pub url: String,
    pub status: String,
    #[serde(default)]
    pub remote_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncExternalResult {
    pub items: Vec<SyncedExternalItem>,
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub deleted_ids: Vec<String>,
}

/// An issue that existed in a tracker before warpforge knew about it. The
/// daemon has already minted `item_id` and persisted the link, so the client
/// only has to add the row to its board.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedWorkItem {
    pub item_id: String,
    #[serde(default)]
    pub number: u64,
    pub provider: String,
    pub project: String,
    pub external_id: String,
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// Normalized status.
    pub status: String,
    /// Provider-native status label.
    #[serde(default)]
    pub remote_status: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    /// Remote's last-updated time, unix seconds.
    #[serde(default)]
    pub updated_at: u64,
}

/// One listing answers both questions, so the result carries both: issues that
/// became new backlog items, and already-tracked ones whose status moved.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalResult {
    pub items: Vec<ImportedWorkItem>,
    #[serde(default)]
    pub synced: Vec<SyncedExternalItem>,
    #[serde(default)]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalWorkItemPage {
    pub items: Vec<ImportedWorkItem>,
    pub page: u32,
    pub page_size: u32,
    /// Exact when provider exposes a count; otherwise omitted and clients use
    /// `hasNextPage` for forward pagination.
    #[serde(default)]
    pub total: Option<u64>,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOutcome {
    Allow,
    AllowAlways,
    Deny,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HunkResolution {
    Accept,
    Reject,
}
