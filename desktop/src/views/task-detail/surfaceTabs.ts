import { useMemo } from "react";

import {
  DEFAULT_SURFACE_TABS,
  type SurfaceTab,
  type WorkspaceSurface,
} from "@/components/workspace";
import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { keepersEligible } from "@/lib/keepers";
import { type LiveItem, liveItems, surfaceTally } from "@/lib/liveActivity";
import { isChat } from "@/lib/taskKind";
import type { Snapshot, TaskInfo } from "@/protocol";

/** A chat has no checkout, services or pipeline: its folder and a shell in it. */
const CHAT_SURFACES: ReadonlySet<WorkspaceSurface> = new Set(["files", "terminal"]);

/**
 * The surfaces a task's workspace offers, with their counts.
 * @param input.chat Whether the task is a chat.
 * @param input.keepers Whether the task can carry keepers; false hides the tab.
 * @param input.diffCount Changed files, undefined for none.
 * @param input.runtimeCount Services and port-forwards, undefined for none.
 * @param input.terminalCount Open terminals, undefined for none.
 * @param input.pipelineCount Pipeline steps; undefined hides the tab.
 * @param input.live The task's live items, for the running/failed dots.
 * @returns The tabs, in rail order.
 */
export function taskSurfaceTabs(input: {
  chat: boolean;
  keepers?: boolean;
  diffCount?: number;
  runtimeCount?: number;
  terminalCount?: number;
  pipelineCount?: number;
  live?: readonly LiveItem[];
}): SurfaceTab[] {
  const live = input.live ?? [];
  return (
    DEFAULT_SURFACE_TABS
      // Hidden unless this task actually farmed work out: an ordinary
      // single-agent task has no pipeline, and a permanently empty tab is
      // just a dead affordance on most of the screens in the app.
      .filter((tab) => tab.id !== "pipeline" || input.pipelineCount !== undefined)
      .filter((tab) => tab.id !== "keepers" || input.keepers === true)
      .filter((tab) => !input.chat || CHAT_SURFACES.has(tab.id))
      .map((tab) => {
        if (tab.id === "diff") return { ...tab, count: input.diffCount };
        if (tab.id === "keepers") return { ...tab, activity: surfaceTally(live, "keepers") };
        if (tab.id === "runtime")
          return { ...tab, activity: surfaceTally(live, "runtime"), count: input.runtimeCount };
        if (tab.id === "terminal")
          return { ...tab, activity: surfaceTally(live, "terminal"), count: input.terminalCount };
        if (tab.id === "pipeline") return { ...tab, count: input.pipelineCount };
        return tab;
      })
  );
}

/**
 * `taskSurfaceTabs` fed from the snapshot: the project's services and
 * port-forwards, and the task's own terminals.
 * @param task The open task.
 * @param snapshot The daemon snapshot.
 * @param chat Whether the task is a chat.
 * @param diffCount Changed files, undefined for none.
 * @param pipelineCount Pipeline steps; undefined hides the tab.
 * @returns The tabs, in rail order.
 */
export function useTaskSurfaceTabs(
  task: TaskInfo,
  snapshot: Snapshot,
  chat: boolean,
  diffCount: number | undefined,
  pipelineCount: number | undefined,
): SurfaceTab[] {
  const { portforwards, services, terminals } = snapshot;
  const keeperState = useTaskKeepers(task.id);
  const keepers = keepersEligible(task);
  return useMemo(() => {
    const live = liveItems(
      { portforwards, services, terminals },
      { project: task.project, taskId: task.id },
      keeperState,
    );
    const count = (items: readonly { project: string }[]) =>
      items.filter((item) => item.project === task.project).length;
    return taskSurfaceTabs({
      chat,
      diffCount,
      keepers,
      live,
      pipelineCount,
      runtimeCount: count(services) + count(portforwards) || undefined,
      terminalCount: live.filter((item) => item.kind === "terminal").length || undefined,
    });
  }, [
    chat,
    diffCount,
    keeperState,
    keepers,
    pipelineCount,
    portforwards,
    services,
    task.id,
    task.project,
    terminals,
  ]);
}

/**
 * The surface to show: the remembered one, unless the task cannot show it.
 * @param surface The surface last picked, shared by every task.
 * @param task The open task.
 * @returns The surface to render.
 */
export function visibleSurface(
  surface: WorkspaceSurface,
  task: Parameters<typeof keepersEligible>[0],
): WorkspaceSurface {
  if (isChat(task)) return CHAT_SURFACES.has(surface) ? surface : "files";
  return surface === "keepers" && !keepersEligible(task) ? "diff" : surface;
}
