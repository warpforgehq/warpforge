import { useEffect, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { ConnectionState } from "@/daemon/types";
import type { TaskPullRequest } from "@/protocol";

/** How stale an opened task's pull request may be before it is re-checked. */
const OPEN_TASK_MAX_AGE_SECS = 15;

/** The pull request a task's branch has, or null. */
export function useTaskPullRequest(taskId: string): TaskPullRequest | null {
  return useSyncExternalStore(
    daemon.subscribe,
    () => daemon.getState().taskPullRequests?.[taskId] ?? null,
    () => null,
  );
}

/**
 * Re-check tasks' pull requests on connect and whenever the window
 * regains focus; the daemon polls open ones in between and throttles repeats.
 * A daemon without `gh` (or without the call) leaves the map empty.
 */
export function useTaskPullRequestSync(connection: ConnectionState) {
  useEffect(() => {
    if (connection !== "connected") return;
    const refresh = () => void daemon.refreshTaskPullRequests().catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [connection]);
}

/** Re-check one task's pull request when it is opened. */
export function useOpenTaskPullRequestRefresh(taskId: string) {
  useEffect(() => {
    void daemon.refreshTaskPullRequests([taskId], OPEN_TASK_MAX_AGE_SECS).catch(() => {});
  }, [taskId]);
}
