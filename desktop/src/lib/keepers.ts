import type {
  KeeperDefinition,
  KeeperEntry,
  KeeperFinding,
  KeeperLoopState,
  KeeperRun,
  KeeperSeverity,
  KeeperTaskState,
  TaskInfo,
} from "@/protocol";

/** The daemon's `KeeperRun.error` for a run whose HEAD moved before it finished. */
export const SUPERSEDED = "superseded";
export const STRIP_LENGTH = 10;

/** The built-in keepers **Add keeper** offers, in menu order. */
export const KEEPER_PRESETS = [
  { id: "review", name: "Review", hint: "Bugs, regressions and edge cases in the change." },
  { id: "slop", name: "Slop", hint: "Code that reads as generated rather than written." },
  { id: "conventions", name: "Conventions", hint: "The change against the project's rules." },
] as const;

export type KeeperPresetId = (typeof KEEPER_PRESETS)[number]["id"];

export type KeeperStatus =
  | "off"
  | "needs_you"
  | "running"
  | "fixing"
  | "waiting"
  | "accepted"
  | "green"
  | "findings"
  | "inconclusive"
  | "idle";

export type StripTone = "green" | "red" | "grey" | "running";

const SEVERITY_RANK: Record<KeeperSeverity, number> = { critical: 0, high: 1, low: 3, medium: 2 };

/**
 * Whether a task can carry keepers: a task of a project that is not a Factory
 * or workflow task, as the daemon's own candidate check.
 * @param task The task.
 * @returns True when the Keepers surface applies.
 */
export function keepersEligible(
  task: Pick<TaskInfo, "kind" | "project" | "origin" | "workflowRun" | "tags">,
): boolean {
  return (
    task.kind !== "chat" &&
    !!task.project &&
    !task.origin &&
    !task.workflowRun &&
    !task.tags.some(
      (tag) => tag === "runner" || tag === "workflow-stage" || tag.startsWith("workflow:"),
    )
  );
}

/**
 * @param preset A built-in keeper.
 * @returns The path and two-line body **Add keeper** writes.
 */
export function presetFile(preset: KeeperPresetId): { path: string; content: string } {
  return { content: `version: 1\npreset: ${preset}\n`, path: `.warpforge/keepers/${preset}.yaml` };
}

/**
 * @param entries The project's keeper files.
 * @returns The presets no file names yet.
 */
export function missingPresets(entries: readonly KeeperEntry[]) {
  const taken = new Set(entries.flatMap((entry) => [entry.id, entry.definition?.preset ?? ""]));
  return KEEPER_PRESETS.filter((preset) => !taken.has(preset.id));
}

/**
 * @param taskId The task the state belongs to.
 * @param raw A `keepers.state` reply, possibly partial.
 * @returns The reply with every list present.
 */
export function normalizeKeeperState(taskId: string, raw: Partial<KeeperTaskState> | null) {
  return {
    findings: raw?.findings ?? [],
    loops: raw?.loops ?? {},
    precision: raw?.precision ?? [],
    runs: raw?.runs ?? [],
    switches: { ...raw?.switches, overrides: raw?.switches?.overrides ?? {} },
    taskId,
  } satisfies KeeperTaskState;
}

/**
 * Fold one `task.keeper` event into a task's keeper state.
 * @param prev The state so far, if any.
 * @param event The event's data.
 * @returns The new state: the run upserted, its findings replaced, the loop set.
 */
export function applyKeeperEvent(
  prev: KeeperTaskState | undefined,
  event: {
    task_id: string;
    keeper_id: string;
    run: KeeperRun;
    findings: KeeperFinding[];
    state: KeeperLoopState;
  },
): KeeperTaskState {
  const base = prev ?? normalizeKeeperState(event.task_id, null);
  const known = base.runs.some((run) => run.id === event.run.id);
  return {
    ...base,
    findings: [...base.findings.filter((f) => f.runId !== event.run.id), ...event.findings],
    loops: { ...base.loops, [event.keeper_id]: event.state },
    runs: known
      ? base.runs.map((run) => (run.id === event.run.id ? event.run : run))
      : [...base.runs, event.run],
  };
}

/**
 * @param state The task's keeper state.
 * @param keeperId A keeper.
 * @returns The keeper's runs, oldest first.
 */
export function keeperRuns(state: KeeperTaskState | undefined, keeperId: string): KeeperRun[] {
  return (state?.runs ?? [])
    .filter((run) => run.keeperId === keeperId)
    .sort((a, b) => a.startedAt - b.startedAt || a.runNumber - b.runNumber);
}

function counted(run: KeeperRun): boolean {
  return run.outcome != null && run.outcome !== "skipped" && run.error !== SUPERSEDED;
}

function lastCounted(runs: readonly KeeperRun[]): KeeperRun | undefined {
  const done = runs.filter(counted);
  return done[done.length - 1];
}

function inFlight(run: KeeperRun): boolean {
  return run.outcome == null && run.error !== SUPERSEDED;
}

/**
 * @param run A run.
 * @returns How its cell in the strip looks.
 */
export function stripTone(run: KeeperRun): StripTone {
  if (inFlight(run)) return "running";
  if (run.error === SUPERSEDED) return "grey";
  if (run.outcome === "green") return "green";
  return run.outcome === "findings" ? "red" : "grey";
}

/**
 * @param run A run.
 * @returns A short line for its cell's tooltip.
 */
export function runLabel(run: KeeperRun): string {
  const head = `Run ${run.runNumber} · ${run.headSha.slice(0, 7)}`;
  if (inFlight(run)) return `${head} · running`;
  if (run.error === SUPERSEDED) return `${head} · superseded by a newer commit`;
  if (run.outcome === "findings") return `${head} · ${run.count} findings`;
  const why = run.error ? ` (${run.error})` : "";
  return `${head} · ${run.outcome}${why}`;
}

/**
 * @param on Whether the keeper is switched on for the task.
 * @param runs The keeper's runs, oldest first.
 * @param loop Its fix loop, if it has one.
 * @returns What the keeper is doing on the task.
 */
export function keeperStatus(
  on: boolean,
  runs: readonly KeeperRun[],
  loop: KeeperLoopState | undefined,
): KeeperStatus {
  if (!on) return "off";
  if (loop?.status === "needs_you") return "needs_you";
  if (runs.some(inFlight)) return "running";
  if (loop?.status === "fixing") return "fixing";
  if (loop?.status === "waiting") return "waiting";
  if (loop?.status === "accepted") return "accepted";
  const last = lastCounted(runs);
  if (!last) return "idle";
  if (last.outcome === "green") return "green";
  return last.outcome === "findings" ? "findings" : "inconclusive";
}

/**
 * @param state The task's keeper state.
 * @param runs The keeper's runs, oldest first.
 * @returns The open or sent findings of its latest counted run, worst first.
 */
export function currentFindings(
  state: KeeperTaskState | undefined,
  runs: readonly KeeperRun[],
): KeeperFinding[] {
  const last = lastCounted(runs);
  if (!last || last.outcome !== "findings") return [];
  return (state?.findings ?? [])
    .filter((f) => f.runId === last.id && (f.status === "open" || f.status === "sent"))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * @param id A keeper.
 * @param definition A keeper's definition, absent for an invalid file.
 * @param state The task's keeper state.
 * @returns Whether the keeper is on for the task.
 */
export function keeperOn(
  id: string,
  definition: KeeperDefinition | undefined,
  state: KeeperTaskState | undefined,
): boolean {
  return state?.switches.overrides[id] ?? definition?.defaultOn ?? false;
}

/**
 * @param state The task's keeper state.
 * @param keeperId A keeper.
 * @returns `fixed / (fixed + dismissed)` and the sample size, or null without one.
 */
export function keeperPrecision(state: KeeperTaskState | undefined, keeperId: string) {
  const entry = state?.precision.find((p) => p.keeperId === keeperId);
  const sample = entry ? entry.fixed + entry.dismissed : 0;
  return entry && sample > 0 ? { ratio: entry.fixed / sample, sample } : null;
}

/**
 * Keepers with any activity on the task and what each is doing; a keeper the
 * task switched off is left out. Definitions are not needed: the sidebar has none.
 * @param state The task's keeper state.
 * @returns Keeper id and status, by id.
 */
export function activeKeepers(
  state: KeeperTaskState | undefined,
): { id: string; status: KeeperStatus; findings: number }[] {
  if (!state) return [];
  const ids = new Set([...state.runs.map((run) => run.keeperId), ...Object.keys(state.loops)]);
  return [...ids].sort().map((id) => {
    const runs = keeperRuns(state, id);
    const on = state.switches.overrides[id] !== false;
    const status = keeperStatus(on, runs, state.loops[id]);
    return { findings: lastCounted(runs)?.count ?? 0, id, status };
  });
}

/**
 * @param id A keeper id.
 * @returns The id as a display name, for places without its definition.
 */
export function keeperIdLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, " ");
}

/**
 * What the task's keepers have not cleared, for the push and pull request
 * dialogs: findings, a check still running, a loop waiting for the owner.
 * @param state The task's keeper state.
 * @returns One phrase per keeper that is not green, empty when all are.
 */
export function keeperPushWarnings(state: KeeperTaskState | undefined): string[] {
  return activeKeepers(state).flatMap(({ findings, id, status }) => {
    const name = keeperIdLabel(id);
    if (status === "running") return [`${name} is still checking`];
    if (status === "needs_you") return [`${name} needs you`];
    const open = status === "findings" || status === "waiting" || status === "fixing";
    if (open && findings > 0)
      return [`${name}: ${findings} ${findings === 1 ? "finding" : "findings"}`];
    return [];
  });
}
