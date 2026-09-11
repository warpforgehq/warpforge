import type { AttentionItem } from "@/lib/attentionRail";
import { flattenTaskTree, isSettledTask, settleableTasks, type TaskTree } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";

import type { SidebarRow } from "./row";
import { needsHuman, resolveTaskState } from "./taskState";
import { isSettledTree } from "./tree";

export interface SidebarRowsInput {
  tasks: readonly TaskInfo[];
  queue: readonly AttentionItem[];
  projectOrder: readonly string[];
  forest: readonly TaskTree[];
  expandedTaskIds: ReadonlySet<string>;
  collapsedProjects: ReadonlySet<string>;
  /** Projects whose "N done" shelf the user has opened. */
  expandedShelves: ReadonlySet<string>;
  /**
   * Tasks that must be rendered wherever they are — the open task and any
   * attention target. A settled task pulls its shelf open rather than leaving
   * the caller scrolling to a row that was never built.
   */
  forceVisibleTaskIds: ReadonlySet<string>;
  openProject: string | null;
  nowSec: number;
}

/**
 * Flatten project → root task → subtask into one list. Nesting is carried per
 * row (`depth`) instead of by nested containers so a workspace with hundreds of
 * tasks stays one virtualized list.
 *
 * There is no "Needs you" block: with `needs_review` resting there, it grew to
 * dozens of rows and stopped meaning anything. Attention is now expressed
 * inline, by the rare row that carries a glyph.
 */
export function buildSidebarRows(input: SidebarRowsInput): SidebarRow[] {
  const {
    collapsedProjects,
    expandedShelves,
    expandedTaskIds,
    forceVisibleTaskIds,
    forest,
    nowSec,
    openProject,
    queue,
    tasks,
  } = input;
  const attentionIds = new Set(queue.map((item) => item.task.id));
  const rows: SidebarRow[] = [];
  const stateOf = (task: TaskInfo) =>
    resolveTaskState(task, { attention: attentionIds.has(task.id), nowSec });

  if (input.projectOrder.length === 0) {
    rows.push({
      hint: "Add one from the Projects view",
      key: "empty:workspace",
      kind: "empty",
      label: "No projects yet",
    });
    return rows;
  }

  const rank = (task: TaskInfo) => (needsHuman(stateOf(task)) ? 0 : 1);
  const byPriority = (a: TaskTree, b: TaskTree) =>
    rank(a.task) - rank(b.task) ||
    b.task.updatedAt - a.task.updatedAt ||
    a.task.id.localeCompare(b.task.id);
  /** History reads newest-first: "what did I just finish", not "what is next". */
  const byRecency = (a: TaskTree, b: TaskTree) =>
    b.task.updatedAt - a.task.updatedAt || a.task.id.localeCompare(b.task.id);

  const pushTree = (tree: TaskTree, depth: number) => {
    const expanded = expandedTaskIds.has(tree.task.id);
    const attention = attentionIds.has(tree.task.id);
    rows.push({
      attention,
      childCount: tree.children.length,
      depth,
      expanded,
      key: `workspace:${tree.task.id}`,
      kind: "task",
      state: resolveTaskState(tree.task, { attention, nowSec }),
      task: tree.task,
    });
    if (!expanded) return;
    // Subtasks are the parent's story, so a settled one stays inline: the shelf
    // only ever holds whole groups.
    for (const child of [...tree.children].sort(byPriority)) pushTree(child, depth + 1);
  };

  for (const name of input.projectOrder) {
    const projectTasks = tasks.filter((task) => task.project === name);
    const live = projectTasks.filter((task) => !isSettledTask(task));
    const expanded = !collapsedProjects.has(name);
    const settleCandidates = settleableTasks(projectTasks, nowSec);
    rows.push({
      attentionCount: live.filter((task) => needsHuman(stateOf(task))).length,
      count: live.length,
      expanded,
      key: `project:${name}`,
      kind: "project",
      name,
      selected: openProject === name,
      settleIds: settleCandidates.map((task) => task.id),
      settlePreview: settleCandidates.slice(0, 3).map((task) => task.title),
    });
    if (!expanded) continue;

    const roots = forest.filter((tree) => tree.task.project === name);
    if (roots.length === 0) {
      rows.push({ hint: null, key: `empty:project:${name}`, kind: "empty", label: "No tasks yet" });
      continue;
    }

    const shelved: TaskTree[] = [];
    const active: TaskTree[] = [];
    for (const tree of roots) (isSettledTree(tree) ? shelved : active).push(tree);
    for (const tree of active.sort(byPriority)) pushTree(tree, 0);
    if (shelved.length === 0) continue;

    const forced = shelved.some((tree) =>
      flattenTaskTree(tree).some((task) => forceVisibleTaskIds.has(task.id)),
    );
    const shelfExpanded = expandedShelves.has(name) || forced;
    // Mirrors the daemon's keep rule: a stale `filesChanged` with no worktree
    // left to protect is nothing at risk, so only a live worktree with
    // unmerged changes is kept.
    const settledInProject = projectTasks.filter(isSettledTask);
    const deletableIds = settledInProject
      .filter((task) => !(Boolean(task.worktree) && task.filesChanged > 0))
      .map((task) => task.id);
    rows.push({
      count: shelved.length,
      deletableIds,
      expanded: shelfExpanded,
      key: `shelf:${name}`,
      keptCount: settledInProject.length - deletableIds.length,
      kind: "shelf",
      project: name,
    });
    if (!shelfExpanded) continue;
    for (const tree of shelved.sort(byRecency)) pushTree(tree, 0);
  }

  return rows;
}
