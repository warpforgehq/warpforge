import type { TaskInfo } from "@/protocol";

export interface TaskTree {
  task: TaskInfo;
  children: TaskTree[];
}

export interface TaskGroupIndex {
  forest: TaskTree[];
  rootByTaskId: Map<string, TaskTree>;
}

/**
 * "There is something to look at." The replacement for the old `needs_review`
 * status: same fact, read off the field that always carried it. A `waiting`
 * task with no diff is simply a conversation the user has not replied to yet.
 */
export function awaitsReview(task: TaskInfo): boolean {
  return task.status === "waiting" && task.filesChanged > 0;
}

/**
 * Finished turns with nothing to look at: the agent parked the task in
 * `waiting`, no diff came out of it, and the user has not replied. These are
 * what "Settle finished turns" bulk-settles in one click — the same reversible
 * settle as the per-row button. Snoozed rows keep their wake countdown, and
 * anything the user already settled is naturally out.
 */
export function settleableTasks(tasks: TaskInfo[], nowSec: number): TaskInfo[] {
  const snoozed = (task: TaskInfo) =>
    typeof task.snoozedAt === "number" &&
    typeof task.snoozedUntil === "number" &&
    task.snoozedUntil > nowSec;
  return tasks.filter(
    (task) =>
      task.status === "waiting" &&
      task.filesChanged === 0 &&
      task.settledOverride !== true &&
      !snoozed(task),
  );
}

/**
 * A task the user is finished with: the agent completed it, or the user marked
 * it handled. These are archive material — they still resolve to a state and
 * stay reachable, but they do not belong in a live tree or a live count.
 *
 * Two mechanisms, one meaning, which is why every "is this still work?" check
 * has to consult both. Filtering on `status !== "done"` alone silently counts
 * everything the user settled by hand.
 */
export function isSettledTask(task: TaskInfo): boolean {
  return task.status === "done" || task.settledOverride === true;
}

/**
 * Build a forest from the daemon's explicit parentTaskId relation. Missing
 * parents remain ordinary roots, which keeps old snapshots and deleted parents
 * usable. Cycles are also promoted to roots instead of disappearing.
 */
export function buildTaskForest(tasks: TaskInfo[]): TaskTree[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, TaskInfo[]>();
  // A surface-owned task (an advisor) is not a member of its parent's group.
  const parentOf = (task: TaskInfo) =>
    task.parentTaskId &&
    !task.origin &&
    byId.has(task.parentTaskId) &&
    task.parentTaskId !== task.id
      ? task.parentTaskId
      : null;

  for (const task of tasks) {
    const parent = parentOf(task);
    if (parent) {
      const siblings = children.get(parent) ?? [];
      siblings.push(task);
      children.set(parent, siblings);
    }
  }

  const roots = tasks.filter((task) => !parentOf(task));
  const visited = new Set<string>();
  const build = (task: TaskInfo, path: Set<string>): TaskTree => {
    visited.add(task.id);
    const nextPath = new Set(path).add(task.id);
    const taskChildren: TaskTree[] = [];
    for (const child of children.get(task.id) ?? []) {
      if (!nextPath.has(child.id)) taskChildren.push(build(child, nextPath));
    }
    return {
      children: taskChildren,
      task,
    };
  };

  const forest = roots.map((task) => build(task, new Set()));
  // A pure cycle has no natural root. Preserve every task by promoting one
  // Unseen member; the path guard prevents recursion through the cycle.
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      forest.push(build(task, new Set()));
    }
  }
  return forest;
}

export function flattenTaskTree(tree: TaskTree): TaskInfo[] {
  return [tree.task, ...tree.children.flatMap(flattenTaskTree)];
}

/**
 * Lead of an orchestration group: tagged `orchestrator-chat` at creation
 * (catches the lead before workers spawn), has children, or runs a workflow.
 */
export function isOrchestratorTask(task: TaskInfo, childCount = 0): boolean {
  return task.tags.includes("orchestrator-chat") || childCount > 0 || task.workflowRun != null;
}

/** Index every task by its explicit orchestration root. */
export function buildTaskGroupIndex(tasks: TaskInfo[]): TaskGroupIndex {
  const forest = buildTaskForest(tasks);
  const rootByTaskId = new Map<string, TaskTree>();
  for (const root of forest) {
    for (const task of flattenTaskTree(root)) rootByTaskId.set(task.id, root);
  }
  return { forest, rootByTaskId };
}
