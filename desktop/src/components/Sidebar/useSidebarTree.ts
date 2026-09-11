import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DaemonState } from "@/daemon";
import { useAgentUpdatesCount } from "@/hooks/useAgentUpdates";
import { useInboxUnseenCount } from "@/hooks/useInboxUnseen";
import { buildAttentionQueue } from "@/lib/attentionRail";
import { buildTaskGroupIndex, isTaskGroupPinned, setTaskGroupPinned } from "@/lib/taskGroups";
import { boardTasks } from "@/lib/taskOrigin";
import { useUi } from "@/store/ui";
import type { View } from "@/store/ui";

import {
  ancestorIds,
  buildSidebarRows,
  isSettledTask,
  needsHuman,
  projectNames,
  resolveTaskState,
  rowHeight,
  sortProjectsByActivity,
  type SidebarRow,
} from "./logic";

export function useSidebarTree(state: DaemonState, openTaskId: string | null) {
  const pinned = useUi((store) => store.pinnedTaskIds);
  const setPinnedTaskIds = useUi((store) => store.setPinnedTaskIds);
  const attentionTargetId = useUi((store) => store.attentionTargetId);
  const attentionTargetNonce = useUi((store) => store.attentionTargetNonce);
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

  const queue = useMemo(
    () => buildAttentionQueue(tasks, state.sessionUpdates),
    [state.sessionUpdates, tasks],
  );
  const taskGroupIndex = useMemo(() => buildTaskGroupIndex(tasks), [tasks]);
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
  // Only the collapsed rail needs this count; expanded renders AgentUpdateBanner,
  // which reads the same cached query.
  const agentUpdates = useAgentUpdatesCount();
  const openProject = openTaskId ? (taskById.get(openTaskId)?.project ?? null) : null;

  const forceVisibleTaskIds = useMemo(
    () => new Set([openTaskId, attentionTargetId].filter((id): id is string => id !== null)),
    [attentionTargetId, openTaskId],
  );

  /**
   * The badge counts what genuinely wants a human right now, not the whole
   * attention queue: that queue also holds every finished task awaiting review,
   * so it reads in the dozens and a permanent "23" is not a signal.
   */
  const blockingCount = useMemo(() => {
    const attentionIds = new Set(queue.map((item) => item.task.id));
    return tasks.filter(
      (task) =>
        !isSettledTask(task) &&
        needsHuman(resolveTaskState(task, { attention: attentionIds.has(task.id), nowSec })),
    ).length;
  }, [nowSec, queue, tasks]);

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

  const rows = useMemo(
    () =>
      buildSidebarRows({
        collapsedProjects,
        expandedShelves,
        expandedTaskIds,
        forceVisibleTaskIds,
        forest: taskGroupIndex.forest,
        nowSec,
        openProject,
        projectOrder: names,
        queue,
        tasks,
      }),
    [
      collapsedProjects,
      expandedShelves,
      expandedTaskIds,
      forceVisibleTaskIds,
      names,
      nowSec,
      openProject,
      queue,
      taskGroupIndex.forest,
      tasks,
    ],
  );

  const settleMarkedIds = useMemo(() => {
    if (!settlingProject) return null;
    for (const row of rows) {
      if (row.kind === "project" && row.name === settlingProject) {
        return new Set(row.settleIds);
      }
    }
    return null;
  }, [rows, settlingProject]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index];
      return row ? rowHeight(row) : 34;
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

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

  const handlePin = useCallback(
    (taskId: string) => {
      setPinnedTaskIds(
        setTaskGroupPinned(
          taskGroupIndex,
          pinned,
          taskId,
          !isTaskGroupPinned(taskGroupIndex, pinned, taskId),
        ),
      );
    },
    [pinned, setPinnedTaskIds, taskGroupIndex],
  );

  const navCount = useCallback(
    (id: View) =>
      id === "control"
        ? blockingCount
        : id === "projects"
          ? names.length
          : id === "inbox"
            ? inboxUnseen
            : 0,
    [blockingCount, inboxUnseen, names.length],
  );

  return {
    agentUpdates,
    deletingShelf,
    handlePin,
    navCount,
    nowSec,
    pinned,
    rows,
    scrollRef,
    setDeletingShelf,
    setSettlingProject,
    settleMarkedIds,
    taskGroupIndex,
    toggleProject,
    toggleShelf,
    toggleTask,
    virtualizer,
  };
}
