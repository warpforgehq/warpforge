//! GitHub via PAT (preferred) or `gh` CLI fallback (deprecated).
//!
//! Preferred: personal access token with `repo` + `read:project`, stored in
//! keychain (`warpforge-github`), used via direct `reqwest` GraphQL/REST.
//! Deprecated: `gh` CLI session — spawns a process per request, blocks the
//! daemon, and is flaky for bulk ops. Kept as fallback until removed in a
//! future version. New code should use `github_token()` + `github_graphql`/REST.
//!
//! Layout: `auth` holds the token and keychain, `cli` the `gh` shim and the
//! repo identity it resolves, `graphql` the API queries, `issues` the issue
//! reads and writes the tracker exposes.

mod auth;
mod cli;
mod graphql;
mod issues;
mod pulls;

pub(super) use auth::{github_keychain_delete, github_keychain_write};
pub use auth::{github_login, github_token};
pub(crate) use cli::github_owner_repo;
pub use issues::take_last_board_warning;
pub(super) use issues::{
    github_create_issue, github_issue_exists, github_list_issues, github_search_issues_page,
};
pub(crate) use pulls::{
    github_pr_comment, github_pr_commits, github_pr_conversation, github_pr_details,
    github_pr_diff, github_pr_list, github_pr_range_diff, github_pr_review,
    github_pr_review_comment,
};

const GITHUB_API: &str = "https://api.github.com";
const GITHUB_GRAPHQL: &str = "https://api.github.com/graphql";
const KEYCHAIN_SERVICE: &str = "warpforge-github";
