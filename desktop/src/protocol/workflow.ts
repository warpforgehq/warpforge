// ── Orchestration DTOs ─────────────────────────────────────────────────────

export interface OrchGraphInfo {
  id: string;
  goal: string;
  nodes: OrchNodeInfo[];
}

export interface OrchNodeInfo {
  id: string;
  kind: OrchNodeKind;
  agent: string;
  status: OrchNodeStatus;
  taskId?: string | null;
  result?: string | null;
}

export type OrchNodeKind = "plan" | "implement" | "review" | "fix" | "merge";

export type OrchNodeStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface OrchestratorConfig {
  plannerAgent: string;
  workerPool: OrchWorkerPool[];
  reviewerPool: OrchReviewerPool[];
  worktreesEnabled: boolean;
}

export interface OrchWorkerPool {
  agent: string;
}

export interface OrchReviewerPool {
  agent: string;
}

// ── Workflow DTOs ──────────────────────────────────────────────────────────

/** One selectable workflow template, from `workflow.list`. */
export interface WorkflowMeta {
  id: string;
  name: string;
  description?: string | null;
  source: WorkflowSource;
  /** False when the YAML failed to parse or validate — listed but unselectable. */
  valid: boolean;
  error?: string | null;
  /** Non-fatal issues (unknown keys, clamped values). */
  warnings?: string[];
  /** Stage names for the picker tooltip, e.g. ["plan","implement","review\u00d72","fix"]. */
  stages?: string[];
  maxRounds?: number;
}

export type WorkflowSource = "project" | "builtin";

/** Live state of a workflow pipeline, carried on its parent task. */
export interface WorkflowRunInfo {
  workflowId: string;
  workflowName: string;
  stage: WorkflowStage;
  /** Current review round, 1-based; 0 until the first review starts. */
  round: number;
  /** Round limit including any user-granted extensions. */
  maxRounds: number;
  verdict?: WorkflowVerdict | null;
  /** Set while the pipeline waits for the user. */
  waiting?: WorkflowWaiting | null;
  /** A pause is queued and takes effect when the running stage finishes. */
  pauseRequested?: boolean;
}

export type WorkflowStage = "plan" | "implement" | "review" | "fix" | "done" | "failed";

export type WorkflowVerdict = "approve" | "request_changes";

export interface WorkflowWaiting {
  kind: WorkflowWaitKind;
  /** Which stage asked (for `question`). */
  stage?: WorkflowStage | null;
  /** The question text, or a findings summary for `limit`. */
  question?: string | null;
}

export type WorkflowWaitKind = "question" | "limit" | "paused";

export type WorkflowDecision = "extend" | "finish" | "stop";

export interface WorkflowEventAgent {
  taskId: string;
  label: string;
  agent: string;
  model?: string | null;
}

export type WorkflowEventKind =
  | "workflow_started"
  | "stage_started"
  | "agent_output"
  | "review_result"
  | "status"
  | "workflow_finished";

export type WorkflowEventTone = "info" | "running" | "success" | "warning" | "error";
