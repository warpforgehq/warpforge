import type {
  AgentAccountLimits,
  AgentSpend,
  DaemonEvent,
  DetectedAgent,
  SessionUpdate,
  Snapshot,
} from "../protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface DaemonState {
  connection: ConnectionState;
  /** Most recent connection, discovery, or handshake failure. Cleared after a successful handshake. */
  connectionError: string | null;
  snapshot: Snapshot;
  /** Retained per-task ACP stream (bounded), keyed by task id. */
  sessionUpdates: Record<string, SessionUpdate[]>;
  /** Service log lines keyed by "project/service", bounded to MAX_SERVICE_LOGS. */
  serviceLogs: Record<string, string[]>;
  /** Port-forward log lines keyed by "project/name", bounded to MAX_PORTFORWARD_LOGS. */
  portforwardLogs: Record<string, string[]>;
  /** Non-null when daemon signals first-run setup is needed. */
  pendingAgentSetup: DetectedAgent[] | null;
  /** Latest per-account harness rate limits, or null until first known. */
  agentLimits?: AgentAccountLimits[] | null;
  /** Latest per-harness API-equivalent spend, or null until first known. */
  agentSpend?: AgentSpend[] | null;
}

export const MAX_SERVICE_LOGS = 1000;
export const MAX_PORTFORWARD_LOGS = 500;
export const MAX_TERMINAL_BUFFER_BYTES = 64 * 1024;
export const MAX_TERMINAL_BUFFER_GLOBAL_BYTES = 512 * 1024;
export const TERMINAL_BUFFER_TTL_MS = 30_000;
export const DAEMON_PROTOCOL_VERSION = 1;

/**
 * Per-request ceiling. An unanswered request used to leave its promise pending
 * forever (a wedged subprocess inside `lsp.detect` spun the Settings list
 * indefinitely). Methods that shell out to package managers, networks, or
 * agents get the wider ceiling; everything else answers in under a second.
 */
export const REQUEST_TIMEOUT_MS = 120_000;
export const SLOW_REQUEST_TIMEOUT_MS = 900_000;
export const SLOW_METHODS = new Set([
  "accounts.import",
  "agents.install",
  "agents.probe",
  "bootstrap.finalize",
  "git.merge",
  "git.push",
  "git.rebase",
  "lsp.install",
  "memory.dream",
  "orchestrate.start",
  "task.create",
  "task.resume",
  "text.enhance",
  "text.generate",
  "tracker.pulls.list",
  "tracker.pulls.details",
  "tracker.pulls.diff",
  "tracker.pulls.commits",
  "tracker.pulls.thread",
  "tracker.pulls.comment",
  "tracker.pulls.review",
  "tracker.pulls.reviewComment",
]);

export type Listener = () => void;
export type EventListener = (event: DaemonEvent) => void;
export type TerminalDataListener = (data: Uint8Array) => void;

export type Constructor<T> = new (...args: any[]) => T;
