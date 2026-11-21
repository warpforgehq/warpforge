//! Reading and writing GitHub pull requests: the inbox listing, the detail
//! body, the file stats + raw patch, the conversation thread, and comments.
//!
//! Every call goes through the shared client in `http`, with whichever
//! credential `auth` resolved — a PAT or the `gh` session's token.
//!
//! Layout: `list` the inbox listing, `details` the body and the changes,
//! `thread` the conversation, `comment` the writes; shared actor shapes live here.

mod checks;
mod comment;
mod commits;
mod details;
mod list;
mod review;
#[cfg(test)]
mod tests;
mod thread;

pub(crate) use checks::{github_pr_checks, parse_checks, HEAD_CHECKS};
pub(crate) use comment::{github_pr_comment, github_pr_review_comment};
pub(crate) use commits::{github_pr_commits, github_pr_range_diff};
pub(crate) use details::{github_pr_details, github_pr_diff};
pub(crate) use list::github_pr_list;
pub(crate) use review::github_pr_review;
pub(crate) use thread::github_pr_conversation;

use serde::Deserialize;

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
