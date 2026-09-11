// ── Diff ────────────────────────────────────────────────────────────────────

export type HunkResolution = "accept" | "reject";

export interface TaskDiff {
  taskId: string;
  /** Tracked and untracked changes combined, in one flat list. */
  files: FileDiff[];
  /** Subset of `files`' paths that are untracked (new) files. */
  untrackedPaths: string[];
  /** False when the untracked-file scan couldn't complete — show an
   * "unavailable" message rather than treating it as zero untracked files. */
  untrackedAvailable: boolean;
  /** `.gitignore`'d file paths; populated only when `diff.get` was called
   * with `includeIgnored` (the "Show Ignored Files" toggle). */
  ignored: string[];
  /** True when the server capped the listing — the list is incomplete. */
  ignoredTruncated: boolean;
  /** False when the ignored-file scan was requested but couldn't complete —
   * show "unavailable" rather than "no ignored files". */
  ignoredAvailable: boolean;
  /** Current git branch of the task's project, if it's a repo. */
  branch?: string | null;
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: Hunk[];
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  resolution: HunkResolution | null;
}

/** Result of `file.contents` — a file's HEAD + working-tree text. */
export interface FileDoc {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldText: string;
  newText: string;
  /** Base64-encoded binary content for images (PNG, JPG, etc). Undefined for text files. */
  newDataBase64?: string;
  oldDataBase64?: string;
}

export interface ProjectFile {
  path: string;
  changed: boolean;
}

/** One line-level match from `file.search` — path plus 1-based line/column. */
export interface SymbolMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

// ── Git ops (update / branch switch) ────────────────────────────────────────

export type GitOpStatus = "up_to_date" | "ok" | "conflict" | "error";

/** Result of `git.update` / `git.switchBranch`. */
export interface GitOpResult {
  status: GitOpStatus;
  message: string;
  /** Files that blocked the op (on `conflict`); empty otherwise. */
  conflicts: string[];
  /** Current branch after the op. */
  branch?: string | null;
}

/** Result of `git.branches`. */
export interface GitBranchList {
  current?: string | null;
  branches: string[];
  /** Remote-tracking refs, e.g. `origin/main`. */
  remotes?: string[];
}

/** One git checkout under a project (its own root, or a nested repo found
 * under it). Result of `git.roots`. */
export interface GitRoot {
  path: string;
  /** Display label: the project name for the primary root, or the path
   * relative to it for a nested one (e.g. "packages/foo"). */
  name: string;
  branch?: string | null;
  remotes: string[];
}

/** Result of `git.roots`. */
export interface GitRoots {
  roots: GitRoot[];
}

/** One named bundle of shelved uncommitted changes. */
export interface ShelfEntry {
  id: string;
  name: string;
  /** Unix seconds. */
  createdAt: number;
  branch?: string | null;
  files: string[];
  /** Subset removed from the worktree by shelving — "Recently Deleted". */
  deletedFiles: string[];
}

/** Result of `shelf.list`. */
export interface ShelfList {
  entries: ShelfEntry[];
}

/** Result of `shelf.get`: the bundle plus its files as diffs. */
export interface ShelfDiff {
  entry: ShelfEntry;
  files: FileDiff[];
}

/** One `git stash` entry. */
export interface StashEntry {
  /** `stash@{n}`. */
  id: string;
  message: string;
  branch?: string | null;
  /** Unix seconds. */
  createdAt: number;
  files: string[];
}

/** Result of `stash.list`. */
export interface StashList {
  entries: StashEntry[];
}

/** Result of `stash.get`: the entry plus its files as diffs. */
export interface StashDiff {
  entry: StashEntry;
  files: FileDiff[];
}

/** Result of `git.ignored` — the toggle's own cheap read, so it never pays
 * for a full tracked+untracked recompute. */
export interface GitIgnoredFiles {
  ignored: string[];
  /** True when the server capped the listing — the list is incomplete. */
  truncated: boolean;
  available: boolean;
}

export interface GitPushFile {
  path: string;
  status: string;
}

export interface GitPushCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  files: GitPushFile[];
}

/** Outgoing commits and their files for the current branch. */
export interface GitPushInfo {
  branch: string;
  remote: string;
  remoteBranch: string;
  upstream: string;
  hasUpstream: boolean;
  commits: GitPushCommit[];
}
