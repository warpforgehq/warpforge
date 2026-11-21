//! GitHub over its HTTP API, with one credential for every call.
//!
//! The credential is a personal access token (environment or keychain) when
//! one is configured, else the token of the `gh auth login` session. `gh` is a
//! token source only: no request spawns it. Both credentials take the same
//! path through one shared `reqwest` client, so a PAT user and a `gh` user see
//! the same behaviour.
//!
//! Layout: `auth` resolves and caches the token, `http` is the client and the
//! status handling, `repo` resolves `owner/repo` from a checkout, `graphql`
//! holds the query texts, `issues` and `batch` the backlog reads and writes,
//! `pulls` the pull request inbox.

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
pub use issues::take_last_board_warning;
pub(super) use issues::{github_create_issue, github_list_issues, github_search_issues_page};
pub(crate) use pulls::{
    github_pr_checks, github_pr_comment, github_pr_commits, github_pr_conversation,
    github_pr_details, github_pr_diff, github_pr_list, github_pr_range_diff, github_pr_review,
    github_pr_review_comment, parse_checks,
};
pub(crate) use repo::github_owner_repo;

const GITHUB_API: &str = "https://api.github.com";
const GITHUB_GRAPHQL: &str = "https://api.github.com/graphql";
const KEYCHAIN_SERVICE: &str = "warpforge-github";
