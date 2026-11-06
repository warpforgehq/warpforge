import { useEffect, useRef, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { ConnectionState } from "@/daemon/types";
import { keepersEligible } from "@/lib/keepers";
import type { KeeperTaskState } from "@/protocol";

/** A task's keeper state, or undefined until it is fetched or an event lands. */
export function useTaskKeepers(taskId: string | null): KeeperTaskState | undefined {
  return useSyncExternalStore(
    daemon.subscribe,
    () => (taskId ? daemon.getState().taskKeepers?.[taskId] : undefined),
    () => undefined,
  );
}

let lastTasks: unknown = null;
let lastIds = "";

function eligibleTaskIds(): string {
  const { tasks } = daemon.getState().snapshot;
  if (tasks !== lastTasks) {
    lastTasks = tasks;
    lastIds = tasks
      .filter((task) => task.status !== "done" && keepersEligible(task))
      .map((task) => task.id)
      .join("\n");
  }
  return lastIds;
}

/**
 * Fetch each open keeper-eligible task's state once per connection, so the
 * sidebar marks show before a task is opened; `task.keeper` keeps them live.
 * The snapshot arrives after `connected`, so this follows the task list.
 */
export function useTaskKeepersSync(connection: ConnectionState) {
  const ids = useSyncExternalStore(daemon.subscribe, eligibleTaskIds, () => "");
  const fetched = useRef(new Set<string>());
  useEffect(() => {
    if (connection !== "connected") fetched.current.clear();
  }, [connection]);
  useEffect(() => {
    if (connection !== "connected" || !ids) return;
    for (const id of ids.split("\n")) {
      if (fetched.current.has(id)) continue;
      fetched.current.add(id);
      void daemon.refreshTaskKeepers(id).catch(() => {});
    }
  }, [connection, ids]);
}
