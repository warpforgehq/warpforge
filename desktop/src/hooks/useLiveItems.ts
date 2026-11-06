import { useMemo, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { type LiveItem, liveItems } from "@/lib/liveActivity";

/**
 * Live items for a task, or for a project when `taskId` is null.
 * @param project The project to read.
 * @param taskId The task whose terminals to include; null for the project's own.
 * @returns The live items from `liveItems`.
 */
export function useLiveItems(project: string, taskId: string | null): LiveItem[] {
  const terminals = useSyncExternalStore(
    daemon.subscribe,
    () => daemon.getState().snapshot.terminals,
  );
  const services = useSyncExternalStore(
    daemon.subscribe,
    () => daemon.getState().snapshot.services,
  );
  const portforwards = useSyncExternalStore(
    daemon.subscribe,
    () => daemon.getState().snapshot.portforwards,
  );
  return useMemo(
    () => liveItems({ portforwards, services, terminals }, { project, taskId }),
    [portforwards, project, services, taskId, terminals],
  );
}
