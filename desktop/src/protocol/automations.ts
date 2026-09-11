// ── Automations ──────────────────────────────────────────────────────────────

/** Which schedule shape the user picked. Only a hint: `trigger.cron` is always
 *  populated and is what the daemon actually schedules on. */
export type AutomationPreset = "hourly" | "every5" | "daily" | "weekdays" | "weekly" | "custom";

export interface AutomationTrigger {
  preset: AutomationPreset;
  /** 5-field cron (`min hour dom month dow`), presets expanded. */
  cron: string;
}

export type AutomationRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped_precheck"
  | "skipped_missed"
  | "skipped_running";

export type AutomationRunTrigger = "scheduled" | "manual";

export interface Automation {
  id: string;
  /** Project *name*, matching `TaskInfo.project`. */
  project: string;
  name: string;
  prompt: string;
  agent: string;
  /** Per-automation model override. null inherits the agent's last-used model. */
  model?: string | null;
  /** Non-model ACP config overrides, keyed by the agent's option id. */
  configOverrides?: Record<string, string>;
  trigger: AutomationTrigger;
  /** IANA zone name. Empty means the daemon host's local zone. */
  timezone: string;
  /** `sh -c` command run before a scheduled run; non-zero exit skips it. */
  precheck?: string | null;
  enabled: boolean;
  missedRunGraceMinutes: number;
  reuseSession: boolean;
  worktree: boolean;
  createdAt: number;
  updatedAt: number;
  /** Next occurrence, epoch SECONDS. null when disabled. */
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: AutomationRunStatus | null;
  /** Task the newest run used — the anchor for `reuseSession`. */
  lastTaskId?: string | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  /** 1-based, monotonic per automation. */
  runNumber: number;
  trigger: AutomationRunTrigger;
  status: AutomationRunStatus;
  /** The occurrence this run belongs to, which is not `startedAt` when the
   *  daemon caught up after being down. Epoch seconds. */
  scheduledFor: number;
  startedAt: number;
  finishedAt?: number | null;
  taskId?: string | null;
  error?: string | null;
  /** First few KiB of the agent's final text; the transcript stays on the task. */
  output?: string | null;
}

/** What `automation.create` needs. */
export interface AutomationInput {
  project: string;
  name: string;
  prompt: string;
  agent: string;
  model?: string | null;
  configOverrides?: Record<string, string>;
  trigger: AutomationTrigger;
  timezone: string;
  precheck?: string | null;
  enabled: boolean;
  missedRunGraceMinutes: number;
  reuseSession: boolean;
  worktree: boolean;
}

/**
 * Edit payload for `automation.update`. Absent fields are left alone. `model`
 * and `precheck` cannot be cleared with `null` — by the time it reaches the
 * daemon that reads as "leave alone" — so `precheck` is cleared by sending `""`
 * (the daemon treats a blank command as "no precheck").
 */
export interface AutomationPatch {
  name?: string;
  prompt?: string;
  project?: string;
  agent?: string;
  model?: string;
  configOverrides?: Record<string, string>;
  trigger?: AutomationTrigger;
  timezone?: string;
  precheck?: string;
  enabled?: boolean;
  missedRunGraceMinutes?: number;
  reuseSession?: boolean;
  worktree?: boolean;
}

export const DEFAULT_MISSED_RUN_GRACE_MINUTES = 720;
