import type {
  KeeperDefinition,
  KeeperEntry,
  KeeperFinding,
  KeeperLoopState,
  KeeperPreset,
  KeeperRun,
  KeeperSeverity,
  KeeperTaskState,
  TaskInfo,
} from "@/protocol";

/** The daemon's `KeeperRun.error` for a run whose HEAD moved before it finished. */
export const SUPERSEDED = "superseded";
export const STRIP_LENGTH = 10;

export type KeeperPresetId = KeeperPreset["id"];

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
  | "draft"
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
 * @param presets The built-ins the daemon offers.
 * @returns The presets no file names yet.
 */
export function missingPresets(entries: readonly KeeperEntry[], presets: readonly KeeperPreset[]) {
  const taken = new Set(entries.flatMap((entry) => [entry.id, entry.definition?.preset ?? ""]));
  return presets.filter((preset) => !taken.has(preset.id));
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
 * @param openFindings How many of the latest counted run's findings are still
 * open or sent, so a run whose findings are all resolved reads quiet.
 * @returns What the keeper is doing on the task.
 */
export function keeperStatus(
  on: boolean,
  runs: readonly KeeperRun[],
  loop: KeeperLoopState | undefined,
  openFindings: number,
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
  if (last.outcome === "draft") return "draft";
  if (last.outcome === "findings") return openFindings > 0 ? "findings" : "green";
  return "inconclusive";
}

/**
 * @param runs A keeper's runs, oldest first.
 * @returns The latest counted run's draft text, or null when that run is not a draft.
 */
export function latestDraft(runs: readonly KeeperRun[]): string | null {
  const last = lastCounted(runs);
  return last?.outcome === "draft" && last.draft?.trim() ? last.draft : null;
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
 * The keeper's latest counted run when it checked an older commit than the
 * task's HEAD; unknown HEAD counts as current.
 * @param state The task's keeper state.
 * @param runs The keeper's runs, oldest first.
 * @returns The run's short sha and whether it was a ready check, or null when current.
 */
export function outdatedRun(
  state: KeeperTaskState | undefined,
  runs: readonly KeeperRun[],
): { sha: string; ready: boolean } | null {
  const head = state?.switches.head;
  const last = lastCounted(runs);
  if (!head || !last || last.headSha === head) return null;
  return { ready: last.trigger === "ready", sha: last.headSha.slice(0, 7) };
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
 * The project's `when: ready` keepers that are on for the task, each with
 * whether a check of it is in flight.
 * @param entries The project's keeper files.
 * @param state The task's keeper state.
 * @returns One item per ready keeper that is on, in file order.
 */
export function readyKeepers(
  entries: readonly KeeperEntry[],
  state: KeeperTaskState | undefined,
): { entry: KeeperEntry; runs: KeeperRun[]; running: boolean }[] {
  return entries
    .filter(
      (entry) =>
        entry.definition?.when === "ready" &&
        !entry.error &&
        keeperOn(entry.id, entry.definition, state),
    )
    .map((entry) => {
      const runs = keeperRuns(state, entry.id);
      return { entry, running: runs.some(inFlight), runs };
    });
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
 * @returns Keeper id, status, finding count and whether its findings are from
 * a ready check of an older commit, by id.
 */
export function activeKeepers(
  state: KeeperTaskState | undefined,
): { id: string; status: KeeperStatus; findings: number; outdated: boolean }[] {
  if (!state) return [];
  const ids = new Set([...state.runs.map((run) => run.keeperId), ...Object.keys(state.loops)]);
  return [...ids].sort().map((id) => {
    const runs = keeperRuns(state, id);
    const on = state.switches.overrides[id] !== false;
    const findings = currentFindings(state, runs).length;
    const status = keeperStatus(on, runs, state.loops[id], findings);
    const outdated = outdatedRun(state, runs)?.ready ?? false;
    return { findings, id, outdated, status };
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
  return activeKeepers(state).flatMap(({ findings, id, outdated, status }) => {
    const name = keeperIdLabel(id);
    if (status === "running") return [`${name} is still checking`];
    if (status === "needs_you") return [`${name} needs you`];
    const open =
      findings > 0 && (status === "findings" || status === "waiting" || status === "fixing");
    if (!outdated && open)
      return [`${name}: ${findings} ${findings === 1 ? "finding" : "findings"}`];
    return [];
  });
}

export type KeeperWorst = "failing" | "running";

/**
 * The task's keepers folded into one mark for the pull-request glyph: a keeper
 * that needs the owner or has open findings beats a check still running.
 * @param state The task's keeper state.
 * @returns The worst state, or null when every keeper is green or there are none.
 */
export function keeperWorst(state: KeeperTaskState | undefined): KeeperWorst | null {
  const marks = activeKeepers(state).map(keeperMark);
  if (marks.includes("failing")) return "failing";
  return marks.includes("checking") ? "running" : null;
}

/**
 * The one rule every keeper mark follows: findings nobody is fixing, or a
 * stop that waits for the owner, fail; a check or a fix in progress is checking.
 * Findings of a ready check on an older commit are advice and show no mark.
 * @param keeper A keeper's status, its latest finding count and whether that
 * count is from a ready check of an older commit.
 * @returns The keeper's mark, or null when it shows none.
 */
export function keeperMark({
  findings,
  outdated = false,
  status,
}: {
  findings: number;
  outdated?: boolean;
  status: KeeperStatus;
}): "failing" | "checking" | null {
  if (status === "needs_you") return "failing";
  if (status === "running" || status === "fixing") return "checking";
  if (outdated) return null;
  return findings > 0 && (status === "findings" || status === "waiting") ? "failing" : null;
}

/**
 * Attention-queue reasons for tasks whose keepers stopped to ask the owner.
 * @param taskKeepers Keeper state by task id.
 * @returns One line per such task, by task id.
 */
export function keeperAttentionReasons(
  taskKeepers: Readonly<Record<string, KeeperTaskState>> | undefined,
): ReadonlyMap<string, string> {
  const reasons = new Map<string, string>();
  for (const [taskId, state] of Object.entries(taskKeepers ?? {})) {
    const names = activeKeepers(state)
      .filter(({ status }) => status === "needs_you")
      .map(({ id }) => keeperIdLabel(id));
    if (names.length === 0) continue;
    const who =
      names.length === 1 ? `${names[0]} keeper needs` : `${names.join(", ")} keepers need`;
    reasons.set(taskId, `${who} your decision`);
  }
  return reasons;
}

/** How each keeper status reads on its card; other surfaces override entries. */
export const KEEPER_STATUS_META: Record<KeeperStatus, { label: string; tone: string }> = {
  accepted: { label: "Accepted", tone: "text-ok" },
  draft: { label: "Draft ready", tone: "text-muted-foreground" },
  findings: { label: "Findings", tone: "text-destructive" },
  fixing: { label: "Fixing", tone: "text-ok" },
  green: { label: "Green", tone: "text-ok" },
  idle: { label: "No runs yet", tone: "text-muted-foreground" },
  inconclusive: { label: "Inconclusive", tone: "text-muted-foreground" },
  needs_you: { label: "Needs you", tone: "text-destructive" },
  off: { label: "Off", tone: "text-muted-foreground" },
  running: { label: "Running", tone: "text-ok" },
  waiting: { label: "Waiting", tone: "text-warn" },
};
