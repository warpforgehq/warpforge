/**
 * Data model for the IndexedDB workspace-session cache.
 *
 * See `docs/specs/ux/03-editor-session-persistence.md`. This is UI intent only:
 * the daemon remains authoritative for file contents, task identity and worktree.
 */

export type SessionSurface = "files" | "diff" | "runtime" | "terminal" | "browser" | "pipeline";
export type ProjectSessionSurface = "backlog" | "pulls" | "files" | "runtime" | "terminal";
export type SessionDiffView = "unified" | "split";

export interface EditorViewState {
  /** repo-relative path; never absolute */
  path: string;
  docHash?: string;
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
  updatedAt: number;
}

export interface DiffHunkPosition {
  file: string;
  /** `${oldStart}:${oldLines}:${newStart}:${newLines}` — semantic, never a row index. */
  hunkKey: string;
  scrollTop: number;
  updatedAt: number;
}

export interface FindSession {
  query: string;
  activeIndex: number;
  updatedAt: number;
}

export interface FileSessionState {
  activePath: string | null;
  tabs: string[];
  views: Record<string, EditorViewState>;
  /** Persisted expansion; a collapsed folder is simply absent. */
  expandedDirs: string[];
  treeScrollTop: number;
  treeScrollLeft: number;
}

export interface DiffSessionState {
  view: SessionDiffView;
  selectedFile: string | null;
  positions: Record<string, DiffHunkPosition>;
  collapsedFiles: string[];
  scrollTop: number;
}

export interface TaskWorkspaceSession {
  version: 1;
  taskId: string;
  project: string;
  worktree?: string;
  activeSurface: SessionSurface;
  files: FileSessionState;
  diff: DiffSessionState;
  findInFiles: FindSession | null;
  updatedAt: number;
}

export interface ProjectWorkspaceSession {
  version: 1;
  project: string;
  rootPath?: string;
  activeSurface: ProjectSessionSurface;
  files: FileSessionState;
  findInFiles: FindSession | null;
  updatedAt: number;
}

export const SESSION_VERSION = 1;
export const DB_NAME = "warpforge-session";
export const DB_VERSION = 1;
export const TASK_STORE = "tasks";
export const PROJECT_STORE = "projects";

/** Debounce for per-key writes; a scroll must not hit the DB on every frame. */
export const WRITE_DEBOUNCE_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TTL_MS = 90 * DAY_MS;
export const MAX_TASK_SESSIONS = 100;
export const MAX_PROJECT_SESSIONS = 50;
export const MAX_TABS = 200;
export const MAX_VIEWS = 2000;
/** Successful-save sweeps are throttled so the hot path stays cheap. */
export const SWEEP_MIN_INTERVAL_MS = 60_000;

export function emptyFileSession(): FileSessionState {
  return {
    activePath: null,
    expandedDirs: [],
    tabs: [],
    treeScrollLeft: 0,
    treeScrollTop: 0,
    views: {},
  };
}

export function emptyDiffSession(): DiffSessionState {
  return { collapsedFiles: [], positions: {}, scrollTop: 0, selectedFile: null, view: "unified" };
}

export function emptyTaskSession(
  taskId: string,
  project: string,
  worktree?: string,
): TaskWorkspaceSession {
  return {
    activeSurface: "diff",
    diff: emptyDiffSession(),
    files: emptyFileSession(),
    findInFiles: null,
    project,
    taskId,
    updatedAt: Date.now(),
    version: SESSION_VERSION,
    worktree,
  };
}

export function emptyProjectSession(project: string, rootPath?: string): ProjectWorkspaceSession {
  return {
    activeSurface: "backlog",
    files: emptyFileSession(),
    findInFiles: null,
    project,
    rootPath,
    updatedAt: Date.now(),
    version: SESSION_VERSION,
  };
}

/** Trim a tab list and its view map to the per-session caps. */
export function capTabList(tabs: string[]): string[] {
  return tabs.length > MAX_TABS ? tabs.slice(tabs.length - MAX_TABS) : tabs;
}

export function capViews(views: Record<string, EditorViewState>, keep: string[]): Record<string, EditorViewState> {
  const keys = Object.keys(views);
  if (keys.length <= MAX_VIEWS) return views;
  const kept = new Set(keep);
  const trimmed: Record<string, EditorViewState> = {};
  let budget = MAX_VIEWS - keep.filter((path) => path in views).length;
  for (const key of keys) {
    if (kept.has(key)) {
      trimmed[key] = views[key];
    } else if (budget > 0) {
      trimmed[key] = views[key];
      budget -= 1;
    }
  }
  return trimmed;
}

/**
 * Restore precedence for the active tab: the stored active path wins only if it
 * is still a known file; otherwise fall back to the last valid tab, then null.
 * A path the daemon no longer lists is never resurrected.
 */
export function preferredActivePath(
  tabs: string[],
  activePath: string | null,
  knownPaths: ReadonlySet<string>,
): { activePath: string | null; tabs: string[] } {
  const validTabs = tabs.filter((path) => knownPaths.has(path));
  if (activePath && knownPaths.has(activePath)) {
    return { activePath, tabs: validTabs.includes(activePath) ? validTabs : [...validTabs, activePath] };
  }
  return { activePath: validTabs[validTabs.length - 1] ?? null, tabs: validTabs };
}

/** Drop view records whose path is no longer in the tree/list. */
export function pruneViews(
  views: Record<string, EditorViewState>,
  knownPaths: ReadonlySet<string>,
): Record<string, EditorViewState> {
  const next: Record<string, EditorViewState> = {};
  for (const [path, view] of Object.entries(views)) {
    if (knownPaths.has(path)) next[path] = view;
  }
  return next;
}
