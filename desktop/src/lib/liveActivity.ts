import type { WorkspaceSurface } from "@/components/workspace/SurfaceTabs";
import { activeKeepers, keeperIdLabel } from "@/lib/keepers";
import type { KeeperTaskState, Snapshot } from "@/protocol";

export type LiveKind = "terminal" | "service" | "portforward" | "keeper";
export type LiveState = "running" | "failed";
/** `task` when the item belongs to the task itself; `project` when the whole project shares it. */
export type LiveScope = "task" | "project";

export interface LiveItem {
  kind: LiveKind;
  name: string;
  state: LiveState;
  scope: LiveScope;
  /** Replaces the state word in the label, such as `needs you`. */
  detail?: string;
}

export interface LiveTally {
  running: number;
  failed: number;
}

/** The surface that shows each kind of live item. */
export const LIVE_SURFACE: Record<LiveKind, WorkspaceSurface> = {
  keeper: "keepers",
  portforward: "runtime",
  service: "runtime",
  terminal: "terminal",
};

const KIND_LABEL: Record<LiveKind, string> = {
  keeper: "Keeper",
  portforward: "Port-forward",
  service: "Service",
  terminal: "Terminal",
};

const SERVICE_STATE: Record<Snapshot["services"][number]["status"], LiveState | null> = {
  failed: "failed",
  running: "running",
  starting: "running",
  stopped: null,
};

const FORWARD_STATE: Record<Snapshot["portforwards"][number]["status"], LiveState | null> = {
  active: "running",
  failed: "failed",
  restarting: "running",
  starting: "running",
  stopped: null,
};

/**
 * What is live for a task or a project: open terminals, and services and
 * port-forwards that are up or failed. Stopped ones are not live.
 * Services and port-forwards are per project, so a task sees its project's
 * with `scope: "project"`; terminals and keepers are the task's own.
 * @param snapshot The daemon snapshot, or the three lists of it.
 * @param owner.project The project to read.
 * @param owner.taskId The task whose terminals to include; absent for the project's own.
 * @param keepers The task's keeper state; ignored without a task.
 * @returns The live items, terminals first, then keepers.
 */
export function liveItems(
  snapshot: Pick<Snapshot, "terminals" | "services" | "portforwards">,
  owner: { project: string; taskId?: string | null },
  keepers?: KeeperTaskState,
): LiveItem[] {
  const taskId = owner.taskId ?? null;
  const items: LiveItem[] = [];
  for (const terminal of snapshot.terminals) {
    if (terminal.project !== owner.project || (terminal.taskId ?? null) !== taskId) continue;
    items.push({
      kind: "terminal",
      name: terminal.command.split("/").pop() || terminal.command,
      scope: taskId ? "task" : "project",
      state: "running",
    });
  }
  if (taskId) items.push(...keeperLiveItems(keepers));
  for (const service of snapshot.services) {
    const state = service.project === owner.project ? SERVICE_STATE[service.status] : null;
    if (state) items.push({ kind: "service", name: service.name, scope: "project", state });
  }
  for (const forward of snapshot.portforwards) {
    const state = forward.project === owner.project ? FORWARD_STATE[forward.status] : null;
    if (state) items.push({ kind: "portforward", name: forward.name, scope: "project", state });
  }
  return items;
}

/**
 * Keepers checking or fixing are running; one that waits for the owner or
 * found something is failed. Green, idle and waiting keepers are not live.
 * @param state A task's keeper state.
 * @returns One item per live keeper.
 */
export function keeperLiveItems(state: KeeperTaskState | undefined): LiveItem[] {
  const items: LiveItem[] = [];
  for (const { findings, id, status } of activeKeepers(state)) {
    const item = { kind: "keeper", name: keeperIdLabel(id), scope: "task" } as const;
    if (status === "running" || status === "fixing")
      items.push({
        ...item,
        detail: status === "running" ? "checking" : "fixing",
        state: "running",
      });
    else if (status === "needs_you") items.push({ ...item, detail: "needs you", state: "failed" });
    else if (status === "findings")
      items.push({ ...item, detail: `${findings} findings`, state: "failed" });
  }
  return items;
}

/**
 * @param items Live items.
 * @returns How many are running and how many failed.
 */
export function liveTally(items: readonly LiveItem[]): LiveTally {
  let failed = 0;
  for (const item of items) if (item.state === "failed") failed += 1;
  return { failed, running: items.length - failed };
}

/**
 * @param tally Counts from `liveTally`.
 * @returns `failed` if anything failed, `running` if anything runs, otherwise null.
 */
export function liveState(tally: LiveTally): LiveState | null {
  if (tally.failed > 0) return "failed";
  return tally.running > 0 ? "running" : null;
}

/**
 * @param items Live items.
 * @param surface A workspace surface.
 * @returns The tally of the items that surface shows, or undefined when none.
 */
export function surfaceTally(
  items: readonly LiveItem[],
  surface: WorkspaceSurface,
): LiveTally | undefined {
  const shown = items.filter((item) => LIVE_SURFACE[item.kind] === surface);
  return shown.length > 0 ? liveTally(shown) : undefined;
}

/**
 * @param item A live item.
 * @returns One line such as `Service web · failed`.
 */
export function liveItemLabel(item: LiveItem): string {
  return `${KIND_LABEL[item.kind]} ${item.name} · ${item.detail ?? item.state}`;
}

/**
 * Tone for a live mark: red when something failed; a keeper still checking
 * pulses grey, since green would read as "passed"; anything else running is green.
 * @param state The mark's state.
 * @param checking Every running item is a keeper's check.
 * @returns The colour classes.
 */
export function liveToneClass(state: LiveState, checking: boolean): string {
  if (state === "failed") return "text-destructive";
  return checking ? "text-muted-foreground motion-safe:animate-pulse" : "text-ok/80";
}
