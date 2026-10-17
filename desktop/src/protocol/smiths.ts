/** Smiths (ADR 0027): persistent, named teammates that outlive their tasks. */

/** Why a Smith may not start sessions. Unknown reasons are kept as-is. */
export type SmithHold = "identity_changed" | "paused" | "budget";

export interface SmithPermissions {
  /** Path prefixes it may write, relative to its worktree; empty = anywhere. */
  writePaths: string[];
  push: boolean;
  createPr: boolean;
}

/** Daily limits; absent = no limit. */
export interface SmithBudget {
  usdPerDay?: number;
  turnsPerDay?: number;
}

export interface Smith {
  id: string;
  /** Unique, case-insensitive; what `@Name` resolves. */
  name: string;
  homeProject: string;
  /** Projects it may work in, the home project included. */
  allowedProjects: string[];
  agent: string;
  model?: string;
  accountId?: string;
  budget: SmithBudget;
  permissions: SmithPermissions;
  /** The hidden task its thread runs in. */
  threadTaskId: string;
  soulRev: string;
  charterRev: string;
  /** Empty when it may start sessions. */
  held?: SmithHold[];
  createdAt: number;
}

/** A Smith with its identity files, for its page. */
export interface SmithDetail {
  smith: Smith;
  soul: string;
  charter: string;
}

/** `smiths.create`: a missing soul or charter starts from a template. */
export interface SmithInput {
  name: string;
  homeProject: string;
  allowedProjects: string[];
  agent: string;
  model?: string | null;
  accountId?: string | null;
  soul?: string;
  charter?: string;
  permissions: SmithPermissions;
  budget: SmithBudget;
}

/** `smiths.update`: only the fields given change; `""` clears model or account. */
export type SmithPatch = Partial<Omit<SmithInput, "homeProject">>;
