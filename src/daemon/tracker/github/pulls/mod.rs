//! Reading and writing GitHub pull requests: the inbox listing, the detail
//! body, the file stats + raw patch, the conversation thread, and comments.
//!
//! Every call has the same two paths as the rest of `github/`: the PAT goes
//! straight to `api.github.com` over reqwest, and without one the same shape
//! arrives through a deprecated `gh` spawn. Both paths land in the same wire
//! types, so callers never learn which one ran.
//!
//! Layout: `list` the inbox listing, `details` the body and the changes,
//! `thread` the conversation, `comment` the writes; the actor shapes and the
//! viewer login they all share live here.

#![allow(deprecated)]

mod comment;
mod commits;
mod details;
mod list;
mod review;
#[cfg(test)]
mod tests;
mod thread;

pub(crate) use comment::{github_pr_comment, github_pr_review_comment};
pub(crate) use commits::{github_pr_commits, github_pr_range_diff};
pub(crate) use details::{github_pr_details, github_pr_diff};
pub(crate) use list::github_pr_list;
pub(crate) use review::github_pr_review;
pub(crate) use thread::github_pr_conversation;

use anyhow::Context;
use serde::Deserialize;

use super::{github_token, GITHUB_API};
use crate::daemon::tracker::NETWORK_TIMEOUT;
use warpforge_protocol as wire;

/// Anything past this and the patch is cut with a `truncated` flag rather
/// than shipped whole: a multi-megabyte payload is a rendering problem for
/// the client, not a feature.
pub(super) const MAX_PR_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// The patch, cut to the cap, and whether cutting happened. Every producer of
/// a patch goes through this: a whole pull request and a commit range are the
/// same rendering problem for the client, and the flag is what lets it say so
/// instead of drawing half a hunk as if it were whole.
pub(super) fn cap_patch(mut patch: String) -> (String, bool) {
    if patch.len() <= MAX_PR_DIFF_BYTES {
        return (patch, false);
    }
    // Cut at a char boundary so the tail is never half a UTF-8 sequence.
    let mut cut = MAX_PR_DIFF_BYTES;
    while cut > 0 && !patch.is_char_boundary(cut) {
        cut -= 1;
    }
    patch.truncate(cut);
    (patch, true)
}

#[derive(Deserialize, Default)]
pub(super) struct RawActor {
    #[serde(default)]
    pub login: String,
}

impl RawActor {
    pub(super) fn into_wire(self) -> Option<wire::PullActor> {
        let login = self.login.trim();
        (!login.is_empty()).then(|| wire::PullActor {
            login: login.to_string(),
            avatar_url: github_avatar_url(login),
        })
    }
}

#[derive(Deserialize, Default)]
pub(super) struct RawNodes<T> {
    #[serde(default)]
    pub total_count: u64,
    #[serde(default)]
    pub nodes: Vec<T>,
}

#[derive(Deserialize, Default)]
pub(super) struct RawLabel {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

pub(super) fn actor_avatar(login: &str) -> Option<String> {
    github_avatar_url(login.trim())
}

/// `https://avatars.githubusercontent.com/{login}?s=64` — GitHub serves this
/// for every account, so the client needs no extra fetch to show an avatar.
pub(super) fn github_avatar_url(login: &str) -> Option<String> {
    let login = login.trim();
    if login.is_empty() {
        return None;
    }
    let mut encoded = String::with_capacity(login.len());
    for byte in login.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    Some(format!(
        "https://avatars.githubusercontent.com/{encoded}?s=64"
    ))
}

/// The login the connected credentials act as: the PAT's identity over REST,
/// else the `gh` session's. Assigned-to-me filtering happens daemon-side, so
/// the caller never needs it — this is only for that filter.
async fn viewer_login(_repo_dir: &str) -> anyhow::Result<String> {
    if let Some(token) = github_token() {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{GITHUB_API}/user"))
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "warpforge")
            .timeout(NETWORK_TIMEOUT)
            .send()
            .await
            .context("GitHub user request")?
            .error_for_status()
            .context("GitHub user request")?;
        let value: serde_json::Value = resp.json().await.context("parsing GitHub user")?;
        let login = value
            .get("login")
            .and_then(|login| login.as_str())
            .unwrap_or_default()
            .to_string();
        if login.is_empty() {
            anyhow::bail!("GitHub did not return a login");
        }
        return Ok(login);
    }
    super::github_login()
        .await
        .ok_or_else(|| anyhow::anyhow!("could not determine the GitHub login"))
}
