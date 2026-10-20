//! The Explorer's lazy file tree (ADR 0028): `dir.list` and `git.status`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Dir,
}

/// One child of a listed directory. A symlink carries its target's kind; a
/// broken one is a file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    #[serde(default)]
    pub symlink: bool,
    /// Matched by `.gitignore`, `info/exclude` or the global excludes file.
    #[serde(default)]
    pub ignored: bool,
}

/// Result of `dir.list`, sorted by name. `truncated` means the directory has
/// more entries than one reply carries.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntry>,
    #[serde(default)]
    pub truncated: bool,
}

/// One changed path from `git.status`. `code` is porcelain v1's two-letter
/// `XY` (index, worktree): `" M"`, `"A "`, `"??"`, `"UU"`, ….
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub code: String,
}

/// Result of `git.status`. `truncated` means more paths changed than one
/// reply carries.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub entries: Vec<StatusEntry>,
    #[serde(default)]
    pub truncated: bool,
}
