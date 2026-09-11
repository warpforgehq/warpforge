import { awaitsReview } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";

import { isSnoozed } from "./snooze";
import type { SidebarTaskState } from "./stateMeta";

/**
 * The three states that actually want a human *now*: a prompt waiting on an
 * answer, a task that cannot proceed, and a session that died. Drives the sort,
 * the dot on a collapsed project and the Mission Control badge. Matches what
 * `buildAttentionQueue` now collects — a finished turn with a diff is not an
 * interruption, and counting it as one made "needs you" mean everything.
 */
export function needsHuman(state: SidebarTaskState): boolean {
  return state === "needs_answer" || state === "blocked" || state === "failed";
}

/**
 * Lifecycle overrides win over the reported status, and an attention flag wins
 * over a status that would contradict it — a task blocked on a permission
 * prompt still reports `running`, and a row that says "running" next to a warn
 * glyph reads as a bug.
 */
export function resolveTaskState(
  task: TaskInfo,
  options: { attention: boolean; nowSec: number },
): SidebarTaskState {
  if (isSnoozed(task, options.nowSec)) return "snoozed";
  if (task.settledOverride === true) return "settled";
  // Only promote when the status does not already explain the attention: a
  // waiting task *with* a diff is in the queue precisely because of that diff,
  // and calling it "needs you" would double-count the review as a question.
  if (
    options.attention &&
    (task.status === "running" || (task.status === "waiting" && !awaitsReview(task)))
  ) {
    return "needs_answer";
  }
  switch (task.status) {
    case "blocked":
      return "blocked";
    case "interrupted":
      return "failed";
    case "running":
      return "working";
    case "queued":
      return "queued";
    case "done":
      return "done";
    default:
      // One status, two rows: `waiting` is where the agent parks either way, so
      // the diff — not a second status — is what says whether there is anything
      // to look at. Both render silently; only the tooltip differs.
      return awaitsReview(task) ? "review" : "idle";
  }
}
