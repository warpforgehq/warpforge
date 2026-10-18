//! Named channels in a project (ADR 0026 addendum). `#general` is implicit:
//! a record whose `channel_id` is null belongs to it.

use serde::{Deserialize, Serialize};

/// A Smith in a channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMember {
    pub smith_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub project: String,
    /// One lowercase word, unique in its project; never `general`.
    pub name: String,
    #[serde(default)]
    pub members: Vec<ChannelMember>,
    pub created_at: u64,
    /// When the newest post the daemon still holds was made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_post_at: Option<u64>,
    /// Members on a turn this channel started, by Smith id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub working: Vec<String>,
}
