import { useMemo } from "react";

import {
  DEFAULT_SURFACE_TABS,
  type SurfaceTab,
  type WorkspaceSurface,
} from "@/components/workspace";
import { type LiveItem, liveItems, surfaceTally } from "@/lib/liveActivity";
import type { Snapshot, TaskInfo } from "@/protocol";

/** A chat has no checkout, services or pipeline: its folder and a shell in it. */
const CHAT_SURFACES: ReadonlySet<WorkspaceSurface> = new Set(["files", "terminal"]);

/**
 * The surfaces a task's workspace offers, with their counts.
 * @param input.chat Whether the task is a chat.
 * @param input.diffCount Changed files, undefined for none.
 * @param input.runtimeCount Services and port-forwards, undefined for none.
 * @param input.terminalCount Open terminals, undefined for none.
 * @param input.pipelineCount Pipeline steps; undefined hides the tab.
 * @param input.live The task's live items, for the running/failed dots.
 * @returns The tabs, in rail order.
 */
export function taskSurfaceTabs(input: {
  chat: boolean;
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
      .filter((tab) => !input.chat || CHAT_SURFACES.has(tab.id))
      .map((tab) => {
        if (tab.id === "diff") return { ...tab, count: input.diffCount };
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
  return useMemo(() => {
    const live = liveItems(
      { portforwards, services, terminals },
      { project: task.project, taskId: task.id },
    );
    const count = (items: readonly { project: string }[]) =>
      items.filter((item) => item.project === task.project).length;
    return taskSurfaceTabs({
      chat,
      diffCount,
      live,
      pipelineCount,
      runtimeCount: count(services) + count(portforwards) || undefined,
      terminalCount: live.filter((item) => item.kind === "terminal").length || undefined,
    });
  }, [chat, diffCount, pipelineCount, portforwards, services, task.id, task.project, terminals]);
}

/**
 * The surface to show: the remembered one, unless a chat cannot show it.
 * @param surface The surface last picked, shared by every task.
 * @param chat Whether the task is a chat.
 * @returns The surface to render.
 */
export function visibleSurface(surface: WorkspaceSurface, chat: boolean): WorkspaceSurface {
  return chat && !CHAT_SURFACES.has(surface) ? "files" : surface;
}
