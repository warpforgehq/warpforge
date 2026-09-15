/**
 * Transient "open this project file" intent, the project-page counterpart of
 * the ui store's `openTaskNav`.
 *
 * It is not in the ui store because the request has to survive the render in
 * which the Files surface first mounts: the palette can fire while the project
 * page is on another surface, so the request waits here until that surface
 * claims it.
 */
export interface ProjectFileRequest {
  project: string;
  path: string;
  line?: number;
  column?: number;
}

let pending: ProjectFileRequest | null = null;
const listeners = new Set<() => void>();

/** Queue a file to open on `request.project`'s Files surface. */
export function requestProjectFile(request: ProjectFileRequest): void {
  pending = request;
  for (const listener of listeners) listener();
}

/** The queued request, or null. Stable between changes, for `useSyncExternalStore`. */
export function getProjectFileRequest(): ProjectFileRequest | null {
  return pending;
}

/**
 * Claim the queued request when it belongs to `project`, clearing it.
 *
 * @param project Project whose surface is claiming the request.
 * @returns The claimed request, or null when none is queued for that project.
 */
export function takeProjectFileRequest(project: string): ProjectFileRequest | null {
  if (!pending || pending.project !== project) return null;
  const claimed = pending;
  pending = null;
  for (const listener of listeners) listener();
  return claimed;
}

/**
 * Subscribe to queue changes.
 *
 * @param listener Called after every queue write.
 * @returns Unsubscribe function.
 */
export function subscribeProjectFileNav(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops the queued request. For tests. */
export function resetProjectFileNav(): void {
  pending = null;
  listeners.clear();
}
