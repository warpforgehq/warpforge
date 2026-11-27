import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DaemonState } from "@/daemon";
import { useAgentUpdatesCount } from "@/hooks/useAgentUpdates";
import { useInboxUnseenCount } from "@/hooks/useInboxUnseen";
import { usePeerAlertReasons, useTeamUnread } from "@/hooks/usePeerFeed";
import { usePrFeedbackReasons } from "@/hooks/usePrFeedbackReasons";
import { buildAttentionQueue } from "@/lib/attentionRail";
import { keeperAttentionReasons } from "@/lib/keepers";
import { buildTaskForest } from "@/lib/taskGroups";
import { isChat } from "@/lib/taskKind";
import { boardTasks } from "@/lib/taskOrigin";
import { useUi } from "@/store/ui";

import {
  ancestorIds,
  buildSidebarRows,
  projectNames,
  rowHeight,
  sortProjectsByActivity,
  type SidebarRow,
} from "./logic";

/**
 * The task tree's rows and the counts the rail shows beside it.
 * @param state the daemon state
 * @param openTaskId the task on screen
 * @param scope projects the tree is narrowed to; null lists every project and chats
 * @returns rows, virtual range and tree actions
 */
export function useSidebarTree(
  state: DaemonState,
  openTaskId: string | null,
  scope: readonly string[] | null = null,
) {
  const attentionTargetId = useUi((store) => store.attentionTargetId);
  const attentionTargetNonce = useUi((store) => store.attentionTargetNonce);
  const selectedProject = useUi((store) => store.selectedProjectId);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [expandedShelves, setExpandedShelves] = useState<Set<string>>(() => new Set());
  const [deletingShelf, setDeletingShelf] = useState<Extract<SidebarRow, { kind: "shelf" }> | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledTargetNonce = useRef<number | null>(null);

  // Board list, not every task: a pull request's Assistant conversation runs
  // as a real task, and the tree is not where it belongs (`lib/taskOrigin`).
  const tasks = useMemo(() => boardTasks(state.snapshot.tasks), [state.snapshot.tasks]);
  const nowSec = Math.floor(Date.now() / 1000);

  // While the pointer rests on a project's bulk-settle button, the tree dims
  // exactly the rows that button would settle — the preview IS the list.
  const [settlingProject, setSettlingProject] = useState<string | null>(null);

  const prFeedback = usePrFeedbackReasons(state.taskPullRequests);
  const peerAlerts = usePeerAlertReasons(tasks);
  const keeperAlerts = useMemo(
    () => keeperAttentionReasons(state.taskKeepers),
    [state.taskKeepers],
  );
  const queue = useMemo(
    () => buildAttentionQueue(tasks, state.sessionUpdates, prFeedback, peerAlerts, keeperAlerts),
    [keeperAlerts, peerAlerts, prFeedback, state.sessionUpdates, tasks],
  );
  const forest = useMemo(() => buildTaskForest(tasks), [tasks]);
  const attentionIds = useMemo(() => new Set(queue.map(({ task }) => task.id)), [queue]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // Recomputed on task-set changes only — deliberately not on `nowSec`, so the
  // order cannot shift under the pointer on a clock tick.
  const names = useMemo(() => {
    const known = projectNames({ projects: state.snapshot.projects });
    return sortProjectsByActivity(known, tasks);
  }, [state.snapshot.projects, tasks]);
  // The inbox's unread count — same query the inbox views render from, so
  // the badge, the tab count and the rows never disagree.
  const inboxUnseen = useInboxUnseenCount(names);
  const teamUnread = useTeamUnread();
  // The rail's agent-update button; the panel's AgentUpdateBanner reads the
  // same cached query.
  const agentUpdates = useAgentUpdatesCount();

  const treeTasks = useMemo(
    () => (scope ? tasks.filter((task) => scope.includes(task.project) && !isChat(task)) : tasks),
    [scope, tasks],
  );
  const treeNames = useMemo(
    () => (scope ? names.filter((name) => scope.includes(name)) : names),
    [names, scope],
  );
  // One project in scope: the panel header already names it, so the tree
  // drops its group row and never leaves it collapsed.
  const single = scope?.length === 1;

  const forceVisibleTaskIds = useMemo(
    () => new Set([openTaskId, attentionTargetId].filter((id): id is string => id !== null)),
    [attentionTargetId, openTaskId],
  );

  /** The open task plus every ancestor: the branch the row rails paint. */
  const activePathIds = useMemo(() => {
    const ids = new Set(ancestorIds(taskById, openTaskId));
    if (openTaskId) ids.add(openTaskId);
    return ids;
  }, [openTaskId, taskById]);

  // A task the user was sent to (toast, wizard) must be reachable even when its
  // parent group or project is collapsed.
  useEffect(() => {
    const target = attentionTargetId ?? openTaskId;
    const parents = [
      ...ancestorIds(taskById, attentionTargetId),
      ...ancestorIds(taskById, openTaskId),
    ];
    if (parents.length > 0) {
      setExpandedTaskIds((current) => {
        if (parents.every((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of parents) next.add(id);
        return next;
      });
    }
    const project = target ? (taskById.get(target)?.project ?? null) : null;
    if (project === null) return;
    setCollapsedProjects((current) => {
      if (!current.has(project)) return current;
      const next = new Set(current);
      next.delete(project);
      return next;
    });
  }, [attentionTargetId, attentionTargetNonce, openTaskId, taskById]);

  const rows = useMemo(() => {
    const built = buildSidebarRows({
      activePathIds,
      collapsedProjects: single ? new Set<string>() : collapsedProjects,
      expandedShelves,
      expandedTaskIds,
      forceVisibleTaskIds,
      forest,
      nowSec,
      projectOrder: treeNames,
      queue,
      selectedProject,
      tasks: treeTasks,
    });
    return single ? built.filter((row) => row.kind !== "project") : built;
  }, [
    activePathIds,
    collapsedProjects,
    expandedShelves,
    expandedTaskIds,
    forceVisibleTaskIds,
    treeNames,
    nowSec,
    queue,
    selectedProject,
    single,
    forest,
    treeTasks,
  ]);

  const settleMarkedIds = useMemo(() => {
    if (!settlingProject) return null;
    for (const row of rows) {
      if (row.kind === "project" && row.name === settlingProject) {
        return new Set(row.settleIds);
      }
    }
    return null;
  }, [rows, settlingProject]);

  // Row heights are designed at the 14px base; ⌘+ and ⌘- scale them with the text.
  const fontScale = useUi((state) => state.fontSize) / 14;
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index];
      return Math.round((row ? rowHeight(row) : 34) * fontScale);
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [fontScale, virtualizer]);

  // The virtualizer mutates in place. Pass its render values to TaskTree so
  // React Compiler can invalidate the JSX when the range or size changes.
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  useEffect(() => {
    if (!attentionTargetId || handledTargetNonce.current === attentionTargetNonce) return;
    const index = rows.findIndex((row) => row.kind === "task" && row.task.id === attentionTargetId);
    if (index < 0) return;
    handledTargetNonce.current = attentionTargetNonce;
    virtualizer.scrollToIndex(index, { align: "center" });
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(attentionTargetId)}"]`)
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attentionTargetId, attentionTargetNonce, rows, virtualizer]);

  const toggleTask = useCallback((taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleProject = useCallback((name: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleShelf = useCallback((name: string) => {
    setExpandedShelves((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  return {
    agentUpdates,
    deletingShelf,
    attentionIds,
    inboxUnseen,
    teamUnread,
    nowSec,
    projectNames: names,
    rows,
    scrollRef,
    setDeletingShelf,
    setSettlingProject,
    settleMarkedIds,
    totalSize,
    toggleProject,
    toggleShelf,
    toggleTask,
    virtualItems,
  };
}
