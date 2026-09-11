import type { ConfigOption } from "./runtime";
import type {
  OrchGraphInfo,
  WorkflowEventAgent,
  WorkflowEventKind,
  WorkflowEventTone,
  WorkflowRunInfo,
  WorkflowStage,
} from "./workflow";

/**
 * Mirrors the Rust `TaskStatus`. `waiting` is one state, not the old
 * `idle` / `needs_review` pair: both meant "the agent yielded its turn", and
 * whether there is a diff to look at is `TaskInfo.filesChanged`, not a status.
 * The daemon still *reads* the legacy spellings off disk, but never emits them.
 */
export type TaskStatus = "queued" | "running" | "waiting" | "blocked" | "interrupted" | "done";

export interface TaskInfo {
  id: string;
  project: string;
  prompt: string;
  agent: string;
  status: TaskStatus;
  tags: string[];
  /** Short imperative label derived from the prompt, or set explicitly. Empty until generated. */
  title: string;
  createdAt: number;
  updatedAt: number;
  filesChanged: number;
  blockedReason: string | null;
  /** The model the user explicitly asked for on this task, if they ever did. */
  model?: string | null;
  /**
   * Why the task is blocked, when the daemon could classify it. `session_lost`
   * means the agent no longer has the saved session and never will — the stored
   * conversation is intact, so the work continues in a fresh session.
   * `model_mismatch` means the session is alive but running on a model other
   * than the requested one; the status is deliberately left unchanged.
   */
  blockedKind?: "session_lost" | "model_mismatch" | null;
  /** Session selectors (model/mode/…) reported by the live ACP session. */
  configOptions?: ConfigOption[];
  /** Path to the git worktree for this task, if isolated. */
  worktree?: string | null;
  /** Orchestration graph for parent orchestrator tasks, and for workflow parents. */
  orchestrationGraph?: OrchGraphInfo | null;
  /** Live pipeline state when this task is a workflow parent. */
  workflowRun?: WorkflowRunInfo | null;
  /** Task that spawned this sub-agent through the orchestrator MCP. */
  parentTaskId?: string | null;
  /** Explicit settle override (true = settled, false = not settled). */
  settledOverride?: boolean | null;
  /** Unix seconds when the task was last settled. */
  settledAt?: number | null;
  /** Unix seconds until which the task is snoozed. */
  snoozedUntil?: number | null;
  /** Unix seconds when the current snooze was set. */
  snoozedAt?: number | null;
  /** True while a permission prompt for this task is unanswered. Computed
   *  daemon-side so the "needs you" badge works without holding transcripts. */
  pendingPermission?: boolean;
  /** What created this task, when it was not the board. `pr-review` is the
   *  shadow task behind a pull request's Assistant tab: the surface owns it,
   *  so board-shaped lists filter it out (`lib/taskOrigin`). */
  origin?: string | null;
}

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PlanEntry {
  content: string;
  status: string; // "pending" | "in_progress" | "completed"
  priority?: string;
}

export interface CommandInfo {
  name: string;
  description: string;
}

export interface FileRange {
  start: number;
  end: number;
}

export type PromptAttachment =
  | { type: "file"; path: string; range?: FileRange }
  | { type: "image"; name: string; mimeType: "image/png" | "image/jpeg"; data: string }
  | { type: "document"; name: string; mimeType: string; text: string };

export interface PromptSubmission {
  text: string;
  attachments: PromptAttachment[];
}

export type PromptAttachmentSummary =
  | { type: "file"; path: string }
  | { type: "image"; name: string }
  | { type: "document"; name: string };

export interface SessionUsageCost {
  amount: number;
  currency: string;
}

export type SessionUpdate =
  | { kind: "user_message"; text: string; attachments?: PromptAttachmentSummary[] }
  | { kind: "prompt_capabilities"; image: boolean; embedded_context: boolean }
  | { kind: "agent_text"; text: string }
  | {
      kind: "workflow_event";
      event: WorkflowEventKind;
      title: string;
      detail?: string | null;
      stage?: WorkflowStage | null;
      agents: WorkflowEventAgent[];
      tone: WorkflowEventTone;
    }
  | { kind: "agent_thought"; text: string }
  | {
      kind: "tool_call";
      tool_call_id: string;
      title: string;
      status: ToolCallStatus;
      tool_kind: string;
      content?: string;
      /** Daemon-preserved start of this tool call, in Unix milliseconds. */
      started_at?: number;
      /**
       * Set by the client, never by the daemon: the permission prompt gating
       * this call, folded in from the `permission_request` that named it. The
       * prompt and the call are one event, so they render as one row.
       */
      pendingPermission?: { request_id: string; options: string[] };
    }
  | {
      kind: "file_edit";
      path: string;
      /** Present on new histories; lets repeated ACP lifecycle frames coalesce. */
      tool_call_id?: string;
      additions?: number;
      deletions?: number;
      /** Concrete per-operation hunks when the ACP agent supplied old/new text. */
      hunks?: EditHunk[];
    }
  | {
      kind: "permission_request";
      request_id: string;
      title: string;
      options: string[];
      /** The tool call this prompt gates, when the agent named one. Absent on
       *  histories recorded before the daemon carried it through. */
      tool_call_id?: string;
    }
  | { kind: "permission_resolved"; request_id: string; outcome: string }
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "available_commands"; commands: CommandInfo[] }
  | { kind: "usage"; used: number; size: number; cost?: SessionUsageCost }
  | { kind: "turn_ended"; stop_reason: string };

export interface EditHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Changed lines only, prefixed with "+" or "-". */
  lines: string[];
}
