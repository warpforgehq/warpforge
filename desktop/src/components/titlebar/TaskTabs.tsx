import { useEffect, useMemo, useRef } from "react";

import { resolveTaskState } from "@/components/Sidebar/logic";
import type { Snapshot, TaskInfo } from "@/protocol";
import { useTabs } from "@/store/tabs";

import { TaskTab } from "./TaskTab";

/**
 * One tab per open task. Opening a task adds its tab; closing a tab only
 * takes it off the strip.
 * @param snapshot board state, for the tasks behind the tabs
 * @param openTaskId the task on screen, or null
 * @param onOpenTask show a task
 * @param onCloseActive the tab on screen closed; show `next`, or leave tasks
 */
export function TaskTabs({
  snapshot,
  openTaskId,
  onOpenTask,
  onCloseActive,
}: {
  snapshot: Snapshot;
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  onCloseActive: (next: string | null) => void;
}) {
  const open = useTabs((s) => s.open);
  const ensure = useTabs((s) => s.ensure);
  const close = useTabs((s) => s.close);
  const move = useTabs((s) => s.move);
  const prune = useTabs((s) => s.prune);
  const reopen = useTabs((s) => s.reopen);

  const byId = useMemo(() => {
    const map = new Map<string, TaskInfo>();
    for (const task of snapshot.tasks) map.set(task.id, task);
    return map;
  }, [snapshot.tasks]);

  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (openTaskId && byId.has(openTaskId)) ensure(openTaskId, lastActive.current);
    if (openTaskId) lastActive.current = openTaskId;
  }, [openTaskId, byId, ensure]);

  useEffect(() => {
    if (snapshot.tasks.length > 0) prune((id) => byId.has(id));
  }, [byId, prune, snapshot.tasks.length]);

  const closeTab = (id: string) => {
    const next = close(id);
    if (id === openTaskId) onCloseActive(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        if (open.length < 2) return;
        event.preventDefault();
        const at = openTaskId ? open.indexOf(openTaskId) : -1;
        const step = event.shiftKey ? -1 : 1;
        onOpenTask(open[(at + step + open.length) % open.length]);
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "t") {
        const id = reopen((tab) => byId.has(tab));
        if (!id) return;
        event.preventDefault();
        onOpenTask(id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openTaskId, onOpenTask, reopen, byId]);

  const tabs = open.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div
      role="tablist"
      aria-label="Open tasks"
      className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto [scrollbar-width:none]"
    >
      {tabs.map((task, index) => (
        <TaskTab
          key={task.id}
          task={task}
          state={resolveTaskState(task, { attention: false, nowSec })}
          active={task.id === openTaskId}
          onSelect={() => onOpenTask(task.id)}
          onClose={() => closeTab(task.id)}
          onDropTab={(dragged) => move(dragged, index)}
        />
      ))}
      <span data-tauri-drag-region className="h-full min-w-6 flex-1" />
    </div>
  );
}
