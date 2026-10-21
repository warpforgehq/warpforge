import type { QueryClient } from "@tanstack/react-query";

import type { DaemonEvent } from "../../../protocol";
import { explorerKeys, type ExplorerSubject } from "./useExplorerData";

export type FsChange = Extract<DaemonEvent, { event: "fs.changed" }>["data"];

/**
 * Refetches what an `fs.changed` says moved: the listed folders, the checkout's
 * git status, and the tracked file list when paths came or went.
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
  if (change.index_changed || change.rescan) {
    void queryClient.invalidateQueries({ queryKey: keys.tracked });
  }
}
