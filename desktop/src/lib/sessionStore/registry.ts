import {
  deleteProject,
  deleteTask,
  getProject,
  getTask,
  putProject,
  putTask,
  subscribeSessionChanges,
} from "./adapter";
import {
  capTabList,
  emptyProjectSession,
  emptyTaskSession,
  pruneViews,
  type DiffHunkPosition,
  type DiffSessionState,
  type EditorViewState,
  type FileSessionState,
  type FindSession,
  type ProjectSessionSurface,
  type ProjectWorkspaceSession,
  type SessionSurface,
  type TaskWorkspaceSession,
} from "./types";

type Listener = () => void;

const taskCache = new Map<string, TaskWorkspaceSession>();
const projectCache = new Map<string, ProjectWorkspaceSession>();
const taskListeners = new Map<string, Set<Listener>>();
const projectListeners = new Map<string, Set<Listener>>();
const loadedTasks = new Set<string>();
const loadedProjects = new Set<string>();
// A scope with writes that predate the stored read must not be replaced by it,
// or a query typed while `loadTask` was in flight would disappear.
const dirtyTasks = new Set<string>();
const dirtyProjects = new Set<string>();

export function isTaskLoaded(taskId: string): boolean {
  return loadedTasks.has(taskId);
}

export function isProjectLoaded(project: string): boolean {
  return loadedProjects.has(project);
}

function emit(map: Map<string, Set<Listener>>, key: string): void {
  map.get(key)?.forEach((listener) => listener());
}

function subscribe(map: Map<string, Set<Listener>>, key: string, listener: Listener): () => void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) map.delete(key);
  };
}

function taskIdentityMatches(
  session: TaskWorkspaceSession,
  project: string,
  worktree?: string,
): boolean {
  return session.project === project && (session.worktree ?? undefined) === (worktree ?? undefined);
}

function projectIdentityMatches(
  session: ProjectWorkspaceSession,
  rootPath?: string,
): boolean {
  return (session.rootPath ?? undefined) === (rootPath ?? undefined);
}

/** Cached session for a task, or a stored seed. Never returns null. */
export function ensureTask(
  taskId: string,
  project: string,
  worktree?: string,
): TaskWorkspaceSession {
  const cached = taskCache.get(taskId);
  if (cached && taskIdentityMatches(cached, project, worktree)) return cached;
  const seed = emptyTaskSession(taskId, project, worktree);
  taskCache.set(taskId, seed);
  return seed;
}

export function ensureProject(project: string, rootPath?: string): ProjectWorkspaceSession {
  const cached = projectCache.get(project);
  if (cached && projectIdentityMatches(cached, rootPath)) return cached;
  const seed = emptyProjectSession(project, rootPath);
  projectCache.set(project, seed);
  return seed;
}

/** Load the task's persisted session, applying identity and stale-path rules. */
export async function loadTask(
  taskId: string,
  project: string,
  worktree?: string,
): Promise<TaskWorkspaceSession> {
  const stored = await getTask(taskId);
  loadedTasks.add(taskId);
  if (!dirtyTasks.has(taskId) && stored && taskIdentityMatches(stored, project, worktree)) {
    const withVersion: TaskWorkspaceSession = { ...stored, version: 1 };
    taskCache.set(taskId, withVersion);
    emit(taskListeners, taskId);
    return withVersion;
  }
  return ensureTask(taskId, project, worktree);
}

export async function loadProject(
  project: string,
  rootPath?: string,
): Promise<ProjectWorkspaceSession> {
  const stored = await getProject(project);
  loadedProjects.add(project);
  if (!dirtyProjects.has(project) && stored && projectIdentityMatches(stored, rootPath)) {
    const withVersion: ProjectWorkspaceSession = { ...stored, version: 1 };
    projectCache.set(project, withVersion);
    emit(projectListeners, project);
    return withVersion;
  }
  return ensureProject(project, rootPath);
}

function commitTask(taskId: string, next: TaskWorkspaceSession): TaskWorkspaceSession {
  const current = taskCache.get(taskId);
  if (current && taskSessionEqual(current, next)) return current;
  dirtyTasks.add(taskId);
  taskCache.set(taskId, next);
  putTask(next);
  emit(taskListeners, taskId);
  return next;
}

function commitProject(project: string, next: ProjectWorkspaceSession): ProjectWorkspaceSession {
  const current = projectCache.get(project);
  if (current && projectSessionEqual(current, next)) return current;
  dirtyProjects.add(project);
  projectCache.set(project, next);
  putProject(next);
  emit(projectListeners, project);
  return next;
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function sameFileSession(a: FileSessionState, b: FileSessionState): boolean {
  return (
    a.activePath === b.activePath &&
    a.treeScrollLeft === b.treeScrollLeft &&
    a.treeScrollTop === b.treeScrollTop &&
    sameStringArray(a.tabs, b.tabs) &&
    sameStringArray(a.expandedDirs, b.expandedDirs) &&
    a.views === b.views
  );
}

function sameDiffSession(a: DiffSessionState, b: DiffSessionState): boolean {
  return (
    a.view === b.view &&
    a.selectedFile === b.selectedFile &&
    a.scrollTop === b.scrollTop &&
    a.positions === b.positions &&
    sameStringArray(a.collapsedFiles, b.collapsedFiles)
  );
}

function sameFindSession(a: FindSession | null, b: FindSession | null): boolean {
  if (a === null || b === null) return a === b;
  return a.query === b.query && a.activeIndex === b.activeIndex;
}

/** Shallow record equality ignoring `updatedAt`, so a render-driven write of an
 *  unchanged value cannot notify subscribers and start an update loop. */
function taskSessionEqual(a: TaskWorkspaceSession, b: TaskWorkspaceSession): boolean {
  return (
    a.taskId === b.taskId &&
    a.project === b.project &&
    a.worktree === b.worktree &&
    a.activeSurface === b.activeSurface &&
    sameFileSession(a.files, b.files) &&
    sameDiffSession(a.diff, b.diff) &&
    sameFindSession(a.findInFiles, b.findInFiles)
  );
}

function projectSessionEqual(a: ProjectWorkspaceSession, b: ProjectWorkspaceSession): boolean {
  return (
    a.project === b.project &&
    a.rootPath === b.rootPath &&
    a.activeSurface === b.activeSurface &&
    sameFileSession(a.files, b.files) &&
    sameFindSession(a.findInFiles, b.findInFiles)
  );
}

export function setTaskSurface(
  taskId: string,
  project: string,
  activeSurface: SessionSurface,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  commitTask(taskId, { ...current, activeSurface, updatedAt: Date.now() });
}

export function setTaskFiles(
  taskId: string,
  project: string,
  files: Partial<FileSessionState>,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  const merged = { ...current.files, ...files };
  commitTask(taskId, {
    ...current,
    files: { ...merged, tabs: capTabList(merged.tabs) },
    updatedAt: Date.now(),
  });
}

export function setTaskEditorView(
  taskId: string,
  project: string,
  path: string,
  view: Partial<EditorViewState>,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  const existing = current.files.views[path];
  if (
    existing &&
    existing.anchor === (view.anchor ?? existing.anchor) &&
    existing.head === (view.head ?? existing.head) &&
    existing.scrollTop === (view.scrollTop ?? existing.scrollTop) &&
    existing.scrollLeft === (view.scrollLeft ?? existing.scrollLeft)
  ) {
    return;
  }
  const nextView: EditorViewState = {
    anchor: view.anchor ?? existing?.anchor ?? 0,
    docHash: view.docHash ?? existing?.docHash,
    head: view.head ?? existing?.head ?? 0,
    path,
    scrollLeft: view.scrollLeft ?? existing?.scrollLeft ?? 0,
    scrollTop: view.scrollTop ?? existing?.scrollTop ?? 0,
    updatedAt: Date.now(),
  };
  commitTask(taskId, {
    ...current,
    files: { ...current.files, views: { ...current.files.views, [path]: nextView } },
    updatedAt: Date.now(),
  });
}

/** Drop view records whose path is no longer in the daemon listing. */
export function pruneTaskViews(taskId: string, knownPaths: ReadonlySet<string>): void {
  const current = taskCache.get(taskId);
  if (!current) return;
  commitTask(taskId, {
    ...current,
    files: { ...current.files, views: pruneViews(current.files.views, knownPaths) },
    updatedAt: current.updatedAt,
  });
}

export function setTaskDiff(
  taskId: string,
  project: string,
  diff: Partial<DiffSessionState>,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  commitTask(taskId, {
    ...current,
    diff: { ...current.diff, ...diff },
    updatedAt: Date.now(),
  });
}

/** Remember which hunk the user navigated to in a file's diff. */
export function setTaskDiffHunkPosition(
  taskId: string,
  project: string,
  file: string,
  hunkKey: string,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  const existing = current.diff.positions[file];
  if (existing?.hunkKey === hunkKey) return;
  commitTask(taskId, {
    ...current,
    diff: {
      ...current.diff,
      positions: {
        ...current.diff.positions,
        [file]: { file, hunkKey, scrollTop: existing?.scrollTop ?? 0, updatedAt: Date.now() },
      },
    },
    updatedAt: Date.now(),
  });
}

/** Drop diff state for files the daemon no longer reports in the diff. */
export function pruneTaskDiff(taskId: string, knownFiles: ReadonlySet<string>): void {
  const current = taskCache.get(taskId);
  if (!current) return;
  const positions: Record<string, DiffHunkPosition> = {};
  for (const [file, position] of Object.entries(current.diff.positions)) {
    if (knownFiles.has(file)) positions[file] = position;
  }
  const collapsedFiles = current.diff.collapsedFiles.filter((file) => knownFiles.has(file));
  const selectedFile =
    current.diff.selectedFile && knownFiles.has(current.diff.selectedFile)
      ? current.diff.selectedFile
      : null;
  commitTask(taskId, {
    ...current,
    diff: { ...current.diff, collapsedFiles, positions, selectedFile },
    updatedAt: current.updatedAt,
  });
}

export function setTaskFind(
  taskId: string,
  project: string,
  findInFiles: FindSession | null,
  worktree?: string,
): void {
  const current = ensureTask(taskId, project, worktree);
  commitTask(taskId, { ...current, findInFiles, updatedAt: Date.now() });
}

export function setProjectSurface(
  project: string,
  activeSurface: ProjectSessionSurface,
  rootPath?: string,
): void {
  const current = ensureProject(project, rootPath);
  commitProject(project, { ...current, activeSurface, updatedAt: Date.now() });
}

export function setProjectFiles(
  project: string,
  files: Partial<FileSessionState>,
  rootPath?: string,
): void {
  const current = ensureProject(project, rootPath);
  const merged = { ...current.files, ...files };
  commitProject(project, {
    ...current,
    files: { ...merged, tabs: capTabList(merged.tabs) },
    updatedAt: Date.now(),
  });
}

export function setProjectEditorView(
  project: string,
  path: string,
  view: Partial<EditorViewState>,
  rootPath?: string,
): void {
  const current = ensureProject(project, rootPath);
  const existing = current.files.views[path];
  if (
    existing &&
    existing.anchor === (view.anchor ?? existing.anchor) &&
    existing.head === (view.head ?? existing.head) &&
    existing.scrollTop === (view.scrollTop ?? existing.scrollTop) &&
    existing.scrollLeft === (view.scrollLeft ?? existing.scrollLeft)
  ) {
    return;
  }
  const nextView: EditorViewState = {
    anchor: view.anchor ?? existing?.anchor ?? 0,
    docHash: view.docHash ?? existing?.docHash,
    head: view.head ?? existing?.head ?? 0,
    path,
    scrollLeft: view.scrollLeft ?? existing?.scrollLeft ?? 0,
    scrollTop: view.scrollTop ?? existing?.scrollTop ?? 0,
    updatedAt: Date.now(),
  };
  commitProject(project, {
    ...current,
    files: { ...current.files, views: { ...current.files.views, [path]: nextView } },
    updatedAt: Date.now(),
  });
}

export function setProjectFind(
  project: string,
  findInFiles: FindSession | null,
  rootPath?: string,
): void {
  const current = ensureProject(project, rootPath);
  commitProject(project, { ...current, findInFiles, updatedAt: Date.now() });
}

export function forgetTask(taskId: string): void {
  taskCache.delete(taskId);
  loadedTasks.delete(taskId);
  dirtyTasks.delete(taskId);
  emit(taskListeners, taskId);
  void deleteTask(taskId);
}

export function forgetProject(project: string): void {
  projectCache.delete(project);
  loadedProjects.delete(project);
  dirtyProjects.delete(project);
  emit(projectListeners, project);
  void deleteProject(project);
}

export function subscribeTask(taskId: string, listener: Listener): () => void {
  return subscribe(taskListeners, taskId, listener);
}

export function subscribeProject(project: string, listener: Listener): () => void {
  return subscribe(projectListeners, project, listener);
}

subscribeSessionChanges((store, key) => {
  if (store === "tasks") {
    taskCache.delete(key);
    emit(taskListeners, key);
  } else {
    projectCache.delete(key);
    emit(projectListeners, key);
  }
});

/** Test hook: clear the in-memory registry. */
export function resetRegistryForTests(): void {
  taskCache.clear();
  projectCache.clear();
  taskListeners.clear();
  projectListeners.clear();
  loadedTasks.clear();
  loadedProjects.clear();
  dirtyTasks.clear();
  dirtyProjects.clear();
}
