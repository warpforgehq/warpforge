import type { QueryClient } from "@tanstack/react-query";

import type { DaemonEvent } from "../../../protocol";
import { explorerKeys, type ExplorerSubject } from "./useExplorerData";

export type FsChange = Extract<DaemonEvent, { event: "fs.changed" }>["data"];

/** Longest the mention list and the diff wait after the first change of a burst. */
export const TRACKED_REFRESH_MS = 1000;

const pendingRefresh = new WeakMap<QueryClient, Set<string>>();

/**
 * Refetches `queryKey` once, `TRACKED_REFRESH_MS` after the first of a burst
 * of changes, so twenty writes cost one listing or one diff.
 */
function refreshSoon(queryClient: QueryClient, queryKey: string[]) {
  const pending = pendingRefresh.get(queryClient) ?? new Set<string>();
  pendingRefresh.set(queryClient, pending);
  const id = JSON.stringify(queryKey);
  if (pending.has(id)) return;
  pending.add(id);
  setTimeout(() => {
    pending.delete(id);
    void queryClient.invalidateQueries({ queryKey });
  }, TRACKED_REFRESH_MS);
}

/**
 * Refetches what an `fs.changed` says moved: the listed folders and the
 * checkout's git status at once; shortly after, the tracked file list — which
 * also holds untracked files — when paths came or went, and a task's diff.
 */
export function applyFsChange(
  queryClient: QueryClient,
  subject: ExplorerSubject,
  change: FsChange,
) {
  const keys = explorerKeys(subject);
  if (change.rescan) {
    void queryClient.invalidateQueries({ queryKey: keys.dirs });
  } else {
    for (const dir of change.dirs) {
      void queryClient.invalidateQueries({ exact: true, queryKey: [...keys.dirs, dir] });
    }
  }
  void queryClient.invalidateQueries({ queryKey: keys.status });
  if (change.index_changed || change.rescan || change.dirs.length > 0) {
    refreshSoon(queryClient, keys.tracked);
  }
  if (subject.taskId) refreshSoon(queryClient, ["diff", subject.taskId]);
}
