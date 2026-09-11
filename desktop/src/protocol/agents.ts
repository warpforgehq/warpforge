import type { ConfigOption } from "./runtime";

// ── Agent registry ──────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  displayName: string;
  acpCommand: string;
  enabled: boolean;
  /** Cached model/effort selectors from the agent's last ACP probe. */
  models: ConfigOption[];
  /** Last model the user explicitly picked; used as default for new tasks. */
  lastModel?: string;
}

export interface DetectedAgent {
  id: string;
  displayName: string;
  installed: boolean;
  defaultAcpCommand: string;
  installHint: string;
  version?: string;
  latestVersion?: string;
  /** "current" | "behind" | "missing" | "unknown" */
  status: string;
  installCommand?: string;
  updateCommand?: string;
  canManage: boolean;
}

/**
 * One registered login for an agent. Never carries credentials — the daemon
 * keeps those in its vault and only reports what the switcher shows.
 */
export interface AccountInfo {
  /** Stable id, "<agent>:<slug>". */
  id: string;
  agentId: string;
  label: string;
  email?: string;
  /** Plan or seat tier, when the agent reports one. */
  plan?: string;
  /** Whether new sessions for this agent use this account. */
  active: boolean;
}

// ── Agent rate limits ───────────────────────────────────────────────────────

/** One usage window (session, weekly, …) on an agent account. */
export interface AgentLimitWindow {
  /** "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "primary" | "secondary"
   *  — plus the synthetic "rate_limited" (usedPercent 100, resetsAt from the
   *  server's Retry-After) when the harness has hard-stopped the account. */
  id: string;
  /** Human label, e.g. "Session" | "Weekly" | "Weekly (Opus)". */
  label: string;
  /** 0..100 */
  usedPercent: number;
  /** Unix SECONDS when the window resets. */
  resetsAt?: number;
  windowMinutes?: number;
}

/** Rate-limit state for one registered agent account. */
export interface AgentAccountLimits {
  /** "<agent>:<slug>", e.g. "claude:personal" */
  accountId: string;
  /** "claude" | "codex" | "opencode" */
  agentId: string;
  label: string;
  /** Currently-active account for that agent. */
  active: boolean;
  /** "plus", "max20", … */
  plan?: string;
  windows: AgentLimitWindow[];
  /** Any window is at 100%. */
  exhausted: boolean;
  /** Unix SECONDS when this snapshot was taken. */
  fetchedAt: number;
  /** "api" | "local" | "unknown" */
  source: string;
  /** Per-account failure, e.g. "not logged in". */
  error?: string;
}

/** Response of the `listAgentLimits` RPC. */
export interface ListAgentLimitsResult {
  accounts: AgentAccountLimits[];
}

/**
 * API-equivalent spend for one harness: what the usage *would* cost at API
 * rates, never an amount charged to the user. A Max/Plus/Team subscription is
 * billed nothing of the sort. Reported per harness, not per account — the cost
 * stream carries no account id.
 */
export interface AgentSpend {
  /** "claude" | "codex" | "opencode" */
  agentId: string;
  /** Accrued in the last 24h; null when unknown. */
  todayUsd: number | null;
  /** All-time total we can account for; null when unknown. */
  totalUsd: number | null;
  /** Tasks that contributed spend. */
  tasks: number;
  /** False when this harness never reports cost at all. */
  reported: boolean;
}

/** Response of the `listAgentSpend` RPC. */
export interface ListAgentSpendResult {
  agents: AgentSpend[];
}

export interface LspStartResult {
  serverId: string;
  available: boolean;
  rootPath: string;
}

/** Install state of one editor language's language server (mirrors Rust). */
export interface DetectedLanguageServer {
  id: string;
  language: string;
  installed: boolean;
  version?: string | null;
  latestVersion?: string | null;
  /** "current" | "behind" | "missing" | "unknown" */
  status: string;
  installCommand?: string | null;
  updateCommand?: string | null;
  canManage: boolean;
  installHint: string;
}
