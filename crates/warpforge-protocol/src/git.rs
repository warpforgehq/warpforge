//! Git working-copy state: branch and root listings, shelves, stashes,
//! push previews, diffs and the file reads the review UI needs.

use crate::{default_true, HunkResolution};
use serde::{Deserialize, Serialize};

/// Machine-readable outcome of a `git.update` / `git.switchBranch` op.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitOpStatus {
    /// Nothing to do — already up to date / already on that branch.
    UpToDate,
    /// Completed cleanly (pulled, or switched with changes carried over).
    Ok,
    /// A conflict was hit and the working tree was rolled back to the exact
    /// prior state. `conflicts` lists the files that blocked it.
    Conflict,
    /// Precondition failed (no upstream, detached HEAD, unknown branch, …).
    Error,
}

/// Result of `git.update` / `git.switchBranch`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
    pub status: GitOpStatus,
    /// Human-readable one-liner for the toast/banner.
    pub message: String,
    /// Files that blocked the op (on `Conflict`); empty otherwise.
    #[serde(default)]
    pub conflicts: Vec<String>,
    /// Current branch after the op (so the UI can refresh its chip).
    #[serde(default)]
    pub branch: Option<String>,
}

/// Result of `git.branches`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchList {
    #[serde(default)]
    pub current: Option<String>,
    pub branches: Vec<String>,
    /// Remote-tracking refs, e.g. `["origin/main", "origin/feature/x"]`.
    #[serde(default)]
    pub remotes: Vec<String>,
}

/// One git checkout under a project — the project's own root, or a nested
/// repo found under it (e.g. a submodule-like checkout that isn't a git
/// submodule). Result of `git.roots`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRoot {
    /// Absolute path to this checkout's toplevel.
    pub path: String,
    /// Display label: the project name for the primary root, or the path
    /// relative to it for a nested one (e.g. `"packages/foo"`).
    pub name: String,
    /// Current branch, or `None` if detached or unborn.
    pub branch: Option<String>,
    /// Configured remote names (e.g. `["origin", "upstream"]`), deduped.
    pub remotes: Vec<String>,
}

/// Result of `git.roots`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitRoots {
    pub roots: Vec<GitRoot>,
}

/// One named bundle of shelved uncommitted changes. Result of `shelf.list`,
/// one element of it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShelfEntry {
    pub id: String,
    pub name: String,
    /// Unix seconds.
    pub created_at: u64,
    /// Branch the changes were shelved from, if any.
    #[serde(default)]
    pub branch: Option<String>,
    /// Repo-relative paths in the bundle, sorted.
    #[serde(default)]
    pub files: Vec<String>,
    /// Subset of `files` removed from the worktree by shelving: shelved
    /// untracked files (deleted from disk) and tracked deletions. Shown as
    /// "Recently Deleted"; a full unshelve restores them.
    #[serde(default)]
    pub deleted_files: Vec<String>,
}

/// Result of `shelf.list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShelfList {
    pub entries: Vec<ShelfEntry>,
}

/// Result of `shelf.get`: the bundle plus its files as diffs, newest
/// preview-ready for the diff view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShelfDiff {
    pub entry: ShelfEntry,
    #[serde(default)]
    pub files: Vec<FileDiff>,
}

/// One `git stash` entry. Result of `stash.list`, one element of it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// `stash@{n}`.
    pub id: String,
    /// Message without git's "On <branch>:" prefix (that is `branch`).
    pub message: String,
    /// Branch the entry was stashed from, parsed from git's own prefix.
    #[serde(default)]
    pub branch: Option<String>,
    /// Unix seconds.
    pub created_at: u64,
    /// Repo-relative paths in the entry, for the list view.
    #[serde(default)]
    pub files: Vec<String>,
}

/// Result of `stash.list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StashList {
    pub entries: Vec<StashEntry>,
}

/// Result of `stash.get`: the entry plus its files as diffs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StashDiff {
    pub entry: StashEntry,
    #[serde(default)]
    pub files: Vec<FileDiff>,
}

/// Result of `git.ignored`: `.gitignore`'d paths plus whether the scan ran.
/// `available=false` means the scan itself failed (e.g. the repo became
/// unreadable) — distinct from "no ignored files", which is an empty list
/// with `available=true`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitIgnoredFiles {
    #[serde(default)]
    pub ignored: Vec<String>,
    /// True when the listing hit the server-side cap — the client says "not
    /// all shown" instead of implying the list is complete.
    #[serde(default)]
    pub truncated: bool,
    #[serde(default = "default_true")]
    pub available: bool,
}

/// One file contained in an outgoing commit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushFile {
    pub path: String,
    /// Git's compact name-status code (`A`, `M`, `D`, `R`, …).
    pub status: String,
}

/// One commit that is not present on the push target.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub files: Vec<GitPushFile>,
}

/// Preview returned by `git.pushInfo`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushInfo {
    pub branch: String,
    pub remote: String,
    pub remote_branch: String,
    /// Configured upstream, or the target Warpforge will create on first push.
    pub upstream: String,
    pub has_upstream: bool,
    pub commits: Vec<GitPushCommit>,
}

/// Result of `diff.get`: the task's working-tree changes, per file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskDiff {
    pub task_id: String,
    /// Tracked and untracked changes combined (untracked files as whole-file
    /// additions) — the flat list the file-content editor iterates over.
    pub files: Vec<FileDiff>,
    /// Subset of `files`' paths that are untracked (new, not yet added to
    /// git). Lets the Changes rail group "Changes" vs "Unversioned Files"
    /// without carrying a second copy of every `FileDiff`.
    #[serde(default)]
    pub untracked_paths: Vec<String>,
    /// False when the untracked-file scan couldn't complete (e.g. the repo
    /// became unreadable mid-scan). The UI must show an "unavailable" message
    /// rather than treat this as "no untracked files".
    #[serde(default)]
    pub untracked_available: bool,
    /// `.gitignore`'d file paths, populated only when `diff.get` was called
    /// with `include_ignored` (the "Show Ignored Files" toggle).
    #[serde(default)]
    pub ignored: Vec<String>,
    /// True when `ignored` hit the server-side listing cap (see
    /// `GitIgnoredFiles.truncated`).
    #[serde(default)]
    pub ignored_truncated: bool,
    /// False when the ignored-file scan couldn't complete while it was
    /// requested (same "unavailable, not empty" contract as
    /// `untracked_available`). Defaults to true so payloads written before
    /// this flag existed still read as "scan ran".
    #[serde(default = "default_true")]
    pub ignored_available: bool,
    /// Current git branch of the task's project, if it's a repo.
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileDiffStatus,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileDiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Unified-diff body lines, each prefixed with ' ', '+', or '-'.
    pub lines: Vec<String>,
    pub resolution: Option<HunkResolution>,
}

/// Result of `file.contents`: a file's HEAD (old) and working-tree (new) text,
/// for the editable side-by-side (CodeMirror merge) review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDoc {
    pub path: String,
    pub status: FileDiffStatus,
    pub old_text: String,
    pub new_text: String,
    /// Base64-encoded binary content for images (PNG, JPG, etc). None for text files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_data_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_data_base64: Option<String>,
}

/// Result of `file.list`: project files available to open in the editor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub path: String,
    #[serde(default)]
    pub changed: bool,
}

/// One line-level match from `file.search` — a project path plus 1-based line and
/// column where `query` appears, with the matching source line for context.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SymbolMatch {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
}
