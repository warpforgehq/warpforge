//! GitHub over its HTTP API. A PAT user and a `gh auth login` user take the
//! same path: `gh` is only a token source and is never spawned per request
//! (ADR-0002, 2026-11-21 amendment).

mod auth;
mod batch;
mod graphql;
mod http;
mod issues;
mod pulls;
mod repo;

pub(crate) use auth::forget_token;
pub(super) use auth::{github_keychain_delete, github_keychain_write};
pub use auth::{github_login, github_token};
pub use batch::{github_issue_states, IssueState};
pub(crate) use http::github_graphql;
pub(super) use issues::{github_create_issue, github_list_issues, github_search_issues_page};
pub(crate) use pulls::{
    github_pr_checks, github_pr_comment, github_pr_commits, github_pr_conversation,
    github_pr_details, github_pr_diff, github_pr_list, github_pr_range_diff, github_pr_review,
    github_pr_review_comment, parse_checks, HEAD_CHECKS,
};
pub(crate) use repo::github_owner_repo;

const GITHUB_API: &str = "https://api.github.com";
const GITHUB_GRAPHQL: &str = "https://api.github.com/graphql";
const KEYCHAIN_SERVICE: &str = "warpforge-github";
