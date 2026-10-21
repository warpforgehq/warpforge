import type { SessionUpdate, TaskInfo } from "@/protocol";

export type FailureKind = "interrupted" | "tool_call" | "orchestration" | "workflow_stage";

export interface FailureInfo {
  kind: FailureKind;
  /** Human-readable one-liner, e.g. "tool call failed", "node implement failed", "stage fix failed", "session lost on daemon restart". */
  reason: string;
}

interface FailureCacheEntry {
  updates: SessionUpdate[];
  /** Daemon merges by tool_call_id: the LAST entry per id is its terminal state. */
  latest: Map<string, { failed: boolean; idx: number; title: string }>;
  lastFailedIdx: number;
  lastFailedTitle: string;
  /** Highest index of a user/agent message, which marks a recovery. */
  lastMessageIdx: number;
}

const failureCache = new Map<string, FailureCacheEntry>();

function cacheFor(taskId: string, updates: SessionUpdate[]): FailureCacheEntry {
  const cached = failureCache.get(taskId);
  if (cached?.updates === updates) return cached;

  // A live chunk either appends or extends the tail text (appendCoalescedUpdate).
  // Tool calls, edits, and permissions merge anywhere in place, so a same-length
  // array only proves a tail change when that tail is a text entry. Anything
  // else (in-place merge, history merge) rebuilds.
  const extendsTail =
    cached !== undefined &&
    updates.length > cached.updates.length &&
    (cached.updates.length === 0 ||
      updates[cached.updates.length - 1] === cached.updates[cached.updates.length - 1]);
  const oldTail = cached?.updates[cached.updates.length - 1];
  const newTail = updates[updates.length - 1];
  const extendsTextTail =
    cached !== undefined &&
    oldTail !== undefined &&
    newTail !== undefined &&
    updates.length === cached.updates.length &&
    newTail.kind === oldTail.kind &&
    (newTail.kind === "agent_text" || newTail.kind === "agent_thought") &&
    (updates.length === 1 || updates[updates.length - 2] === cached.updates[updates.length - 2]);

  const entry: FailureCacheEntry =
    cached && (extendsTail || extendsTextTail)
      ? cached
      : {
          lastFailedIdx: -1,
          lastFailedTitle: "",
          lastMessageIdx: -1,
          latest: new Map(),
          updates,
        };
  const start =
    cached && extendsTail
      ? cached.updates.length
      : cached && extendsTextTail
        ? updates.length - 1
        : 0;

  for (let index = Math.max(start, 0); index < updates.length; index += 1) {
    const update = updates[index];
    if (update.kind === "tool_call") {
      entry.latest.set(update.tool_call_id, {
        failed: update.status === "failed",
        idx: index,
        title: update.title,
      });
    } else if (update.kind === "user_message" || update.kind === "agent_text") {
      entry.lastMessageIdx = index;
    }
  }

  entry.lastFailedIdx = -1;
  entry.lastFailedTitle = "";
  for (const value of entry.latest.values()) {
    if (value.failed && value.idx > entry.lastFailedIdx) {
      entry.lastFailedIdx = value.idx;
      entry.lastFailedTitle = value.title;
    }
  }
  entry.updates = updates;
  failureCache.set(taskId, entry);
  return entry;
}

function latestToolCallFailure(taskId: string, updates: SessionUpdate[]): { title: string } | null {
  const entry = cacheFor(taskId, updates);
  if (entry.lastFailedIdx === -1) return null;
  // A later user/agent message after the last failed call means the session
  // moved on — treat it as recovered rather than failed.
  if (entry.lastMessageIdx > entry.lastFailedIdx) return null;
  const title = entry.lastFailedTitle;
  return { title: title.length > 60 ? `${title.slice(0, 57)}...` : title };
}

/** Returns why this task counts as Failed, or null if it doesn't. */
export function detectFailure(
  task: TaskInfo,
  updates: SessionUpdate[] | undefined,
): FailureInfo | null {
  if (task.workflowRun?.waiting != null && task.workflowRun.waiting.kind !== "paused") {
    return null;
  }
  if (task.status === "blocked") return null;

  if (task.status === "interrupted") {
    return { kind: "interrupted", reason: "session lost on daemon restart" };
  }

  if (updates) {
    const failedCall = latestToolCallFailure(task.id, updates);
    if (failedCall) {
      return { kind: "tool_call", reason: `tool call failed: ${failedCall.title}` };
    }
  }

  const failedNode = task.orchestrationGraph?.nodes.find((n) => n.status === "failed");
  if (failedNode) {
    return {
      kind: "orchestration",
      reason: `node ${failedNode.kind} failed`,
    };
  }

  if (task.workflowRun?.stage === "failed") {
    return { kind: "workflow_stage", reason: "workflow stage failed" };
  }

  return null;
}

export function buildFailureList(
  tasks: TaskInfo[],
  sessionUpdates: Record<string, SessionUpdate[]>,
): Array<{ task: TaskInfo } & FailureInfo> {
  const failures: Array<{ task: TaskInfo } & FailureInfo> = [];
  const liveIds = new Set(tasks.map((task) => task.id));
  for (const taskId of failureCache.keys()) {
    if (!liveIds.has(taskId)) failureCache.delete(taskId);
  }
  for (const task of tasks) {
    const failure = detectFailure(task, sessionUpdates[task.id]);
    if (failure) failures.push({ task, ...failure });
  }
  return failures.sort((a, b) => b.task.updatedAt - a.task.updatedAt);
}
