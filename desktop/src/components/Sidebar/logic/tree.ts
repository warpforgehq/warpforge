import { flattenTaskTree, isSettledTask, type TaskTree } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";

export { isSettledTask };

/**
 * A root only leaves the tree when its *whole* group has settled. A workflow
 * parent reported done while a child is still running must keep the child
 * reachable, so one live descendant holds the entire group in place.
 */
export function isSettledTree(tree: TaskTree): boolean {
  return flattenTaskTree(tree).every(isSettledTask);
}

/** Chain of parents above `taskId`, nearest first. Cycle-safe. */
export function ancestorIds(byId: ReadonlyMap<string, TaskInfo>, taskId: string | null): string[] {
  if (!taskId) return [];
  const ids: string[] = [];
  let current = byId.get(taskId)?.parentTaskId ?? null;
  const guard = new Set<string>([taskId]);
  while (current && !guard.has(current)) {
    guard.add(current);
    ids.push(current);
    current = byId.get(current)?.parentTaskId ?? null;
  }
  return ids;
}
