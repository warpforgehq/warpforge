/** Keepers (ADR 0030): agents attached to a task that check its committed change. */
import type { SessionUsageCost } from "./tasks";

export type KeeperWhen = "commit" | "ready" | "ci" | "comments";
export type KeeperResultKind = "findings" | "pass_fail" | "verdict" | "draft";
export type KeeperSeverity = "critical" | "high" | "medium" | "low";
export type KeeperOutcome = "green" | "findings" | "inconclusive" | "error" | "skipped";
export type KeeperFindingStatus = "open" | "sent" | "fixed" | "dismissed" | "superseded";

/** A keeper file after its preset is applied and its values are validated. */
export interface KeeperDefinition {
  /** The file stem. */
  id: string;
  name: string;
  description?: string;
  preset?: string;
  when: KeeperWhen;
  result: KeeperResultKind;
  agent?: string;
  model?: string;
  effort?: string;
  timeLimitSecs: number;
  maxRounds: number;
  minSeverity: KeeperSeverity;
  /** Whether a new task in the project starts with this keeper on. */
  defaultOn: boolean;
  /** Globs; a leading `!` excludes. Absent means every path. */
  paths?: string[];
  /** The full prompt template, preamble included, before rendering. */
  prompt: string;
}

/** One keeper file from `keepers.list`; an invalid file carries `error`. */
export interface KeeperEntry {
  id: string;
  definition?: KeeperDefinition;
  error?: string;
  warnings?: string[];
}

/** A task's per-keeper switches over each file's `default`. */
export interface TaskKeepers {
  overrides: Record<string, boolean>;
}

export interface KeeperRun {
  id: string;
  taskId: string;
  keeperId: string;
  runNumber: number;
  trigger: KeeperWhen;
  headSha: string;
  baseSha?: string | null;
  startedAt: number;
  finishedAt?: number | null;
  /** Absent while the run is in flight. */
  outcome?: KeeperOutcome | null;
  /** Findings at or above the keeper's `minSeverity`. */
  count: number;
  checkerTaskId?: string | null;
  round: number;
  cost?: SessionUsageCost | null;
  error?: string | null;
}

export interface KeeperFinding {
  id: string;
  runId: string;
  key: string;
  severity: KeeperSeverity;
  file?: string | null;
  line?: number | null;
  description: string;
  status: KeeperFindingStatus;
  dismissReason?: string | null;
  resolvedAt?: number | null;
}

/** Resolved findings of one keeper across the project; precision is
 *  `fixed / (fixed + dismissed)`. */
export interface KeeperPrecision {
  keeperId: string;
  fixed: number;
  dismissed: number;
}

/** The reply to `keepers.state`. */
export interface KeeperTaskState {
  taskId: string;
  switches: TaskKeepers;
  runs: KeeperRun[];
  findings: KeeperFinding[];
  precision: KeeperPrecision[];
}
