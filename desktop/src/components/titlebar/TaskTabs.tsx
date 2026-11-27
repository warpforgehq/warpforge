import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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

  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measureEdges = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const left = strip.scrollLeft > 1;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setEdges((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    measureEdges();
    const observer = new ResizeObserver(measureEdges);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measureEdges, open.length]);

  useEffect(() => {
    if (!openTaskId) return;
    const tab = stripRef.current?.querySelector<HTMLElement>(`[data-task-tab="${openTaskId}"]`);
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [openTaskId, open.length]);

  const tabs = open.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Open tasks"
      onScroll={measureEdges}
      onWheel={(event) => {
        const strip = stripRef.current;
        if (!strip || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        strip.scrollLeft += event.deltaY;
      }}
      style={fadeMask(edges)}
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

/** A soft fade on whichever edge has tabs scrolled past it. */
function fadeMask(edges: { left: boolean; right: boolean }): CSSProperties | undefined {
  if (!edges.left && !edges.right) return undefined;
  const left = edges.left ? "transparent, black 24px" : "black";
  const right = edges.right ? "black calc(100% - 32px), transparent" : "black";
  const mask = `linear-gradient(to right, ${left}, ${right})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}
