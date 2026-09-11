//! The local backlog: storage mode, settings and paged items.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BacklogStorageMode {
    #[default]
    Sqlite,
    Yaml,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacklogSettings {
    pub mode: BacklogStorageMode,
}

/// How long finished tasks keep their data, per lifecycle stage.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    /// Days before a closed task's conversation is deleted.
    pub retention_days: u32,
    /// Days before an ignored diff-less waiting task is settled. `0` = off.
    pub settle_ignored_after_days: u32,
    /// Days before an untouched closed task is deleted outright. `0` = off.
    pub delete_closed_after_days: u32,
}

/// Result of `task.deleteSettled`: how the bulk shelf-clear split.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSettledResult {
    pub deleted: u64,
    /// Skipped because of unmerged changes, a live run, or a pending
    /// permission request.
    pub kept: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacklogItem {
    pub id: String,
    pub number: u64,
    pub project: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub status: String,
    pub priority: String,
    pub source: String,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub remote_status: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacklogPage {
    pub items: Vec<BacklogItem>,
    pub page: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_next_page: bool,
}
