//! The Explorer's lazy file tree: one directory per `dir.list` (ADR 0028).

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
