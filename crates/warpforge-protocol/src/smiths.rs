//! Smiths (ADR 0027): persistent, named agents that outlive their tasks. A
//! Smith has no role — the role is in each assignment (invariant 1).

use serde::{Deserialize, Serialize};

/// Why a Smith may not start sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmithHold {
    /// Its soul or charter changed outside the daemon; the user accepts or
    /// reverts the change.
    IdentityChanged,
    Paused,
    Budget,
}

/// What a Smith's work sessions may do beyond reading.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmithPermissions {
    /// Path prefixes it may write, relative to its worktree; empty = anywhere.
    #[serde(default)]
    pub write_paths: Vec<String>,
    #[serde(default)]
    pub push: bool,
    #[serde(default)]
    pub create_pr: bool,
}

/// Daily limits; `None` = no limit.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmithBudget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usd_per_day: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turns_per_day: Option<u32>,
}

/// A Smith as the daemon keeps it. Identity text (soul, charter) lives in its
/// identity repo and is only in [`SmithDetail`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Smith {
    pub id: String,
    /// Unique, case-insensitive; what `@Name` resolves.
    pub name: String,
    pub home_project: String,
    /// Projects it may work in, `home_project` included.
    pub allowed_projects: Vec<String>,
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default)]
    pub budget: SmithBudget,
    #[serde(default)]
    pub permissions: SmithPermissions,
    /// The hidden task the Smith's thread runs in.
    pub thread_task_id: String,
    /// The identity repo commit that last changed `soul.md`.
    pub soul_rev: String,
    /// The identity repo commit that last changed `charter.yaml`.
    pub charter_rev: String,
    /// Empty when it may start sessions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<SmithHold>,
    pub created_at: u64,
}

/// A Smith with its identity files, for the Smith's page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmithDetail {
    pub smith: Smith,
    pub soul: String,
    pub charter: String,
}

/// `smiths.create` params. A missing soul or charter starts from a template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmithCreate {
    pub name: String,
    pub home_project: String,
    #[serde(default)]
    pub allowed_projects: Vec<String>,
    pub agent: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub soul: Option<String>,
    #[serde(default)]
    pub charter: Option<String>,
    #[serde(default)]
    pub permissions: Option<SmithPermissions>,
    #[serde(default)]
    pub budget: Option<SmithBudget>,
}

/// `smiths.update` params: only the fields given change. An empty `model` or
/// `account_id` clears it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SmithPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub soul: Option<String>,
    #[serde(default)]
    pub charter: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub allowed_projects: Option<Vec<String>>,
    #[serde(default)]
    pub permissions: Option<SmithPermissions>,
    #[serde(default)]
    pub budget: Option<SmithBudget>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_smith_has_no_role_and_round_trips() {
        let smith = Smith {
            id: "sm_1".into(),
            name: "Ada".into(),
            home_project: "demo".into(),
            allowed_projects: vec!["demo".into()],
            agent: "claude".into(),
            model: None,
            account_id: None,
            budget: SmithBudget::default(),
            permissions: SmithPermissions::default(),
            thread_task_id: "t_1".into(),
            soul_rev: "abc".into(),
            charter_rev: "abc".into(),
            held: vec![SmithHold::IdentityChanged],
            created_at: 1,
        };
        let json = serde_json::to_value(&smith).unwrap();
        assert!(json.get("role").is_none());
        assert_eq!(json["held"], serde_json::json!(["identity_changed"]));
        assert_eq!(serde_json::from_value::<Smith>(json).unwrap(), smith);
    }
}
