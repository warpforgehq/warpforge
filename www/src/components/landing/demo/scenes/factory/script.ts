/**
 * A Factory run, beat by beat, in the order the daemon emits it: the parent's
 * `task.updated` carries each stage change, the stage tasks report through
 * their own sessions, and the parent's conversation gets the workflow cards.
 */
import type { DaemonEvent, WorkflowEventAgent } from "@app/protocol";

import { say, tool } from "../beats";
import type { Beat } from "../types";
import {
  FACTORY_TASK_ID,
  FIX_ID,
  fixTask,
  IMPLEMENT_ID,
  implementTask,
  parentAt,
  pullRequest,
  REVIEW_ID,
  reviewTask,
  runnerAt,
} from "./fixtures";

type Card = Extract<Parameters<typeof say>[1], { kind: "workflow_event" }>;

const card = (
  event: Card["event"],
  title: string,
  tone: Card["tone"],
  extra: { agents?: WorkflowEventAgent[]; detail?: string; stage?: Card["stage"] } = {},
): DaemonEvent =>
  say(FACTORY_TASK_ID, { agents: [], kind: "workflow_event", ...extra, event, title, tone });

const parent = (...args: Parameters<typeof parentAt>): DaemonEvent => ({
  data: parentAt(...args),
  event: "task.updated",
});

const runner = (...args: Parameters<typeof runnerAt>): DaemonEvent => ({
  data: runnerAt(...args),
  event: "runner.updated",
});

const IMPLEMENTER = { agent: "claude", label: "implement", taskId: IMPLEMENT_ID };
const REVIEWER = { agent: "codex", label: "reviewer (codex)", taskId: REVIEW_ID };
const FIXER = { agent: "claude", label: "fix (round 1)", taskId: FIX_ID };

const FINDING =
  "1. [medium] `api/src/routes/invoices.ts:7` — the CSV branch ignores `range(req)` validation, so an inverted range returns every invoice (reviewer (codex))";

export const script: Beat[] = [
  // A replay starts queued, with no Pipeline tab to stay on.
  { after: 0, ui: { activeSurface: "diff" } },

  // Picked up from the queue: the parent gets its worktree and the run starts.
  { after: 1400, event: runner({ resolvedLocation: "worktree", state: "running" }) },
  { after: 100, event: parent({ stage: "implement" }, 0) },
  {
    after: 200,
    event: card("workflow_started", "Workflow started: Review loop", "info", {
      detail: "**Stages:** implement → review → fix  \n**Review limit:** 3 round(s)",
    }),
  },
  { after: 300, event: { data: implementTask, event: "task.created" } },
  {
    after: 100,
    event: card("stage_started", "Implement started", "running", {
      agents: [IMPLEMENTER],
      stage: "implement",
    }),
  },
  {
    after: 300,
    event: say(IMPLEMENT_ID, {
      kind: "user_message",
      text: "You are the implementation stage of a workflow pipeline. Implement the task completely: write the code, keep the change focused, and verify your work with builds/tests where feasible.\n\n## Task\n#128 Export invoices as CSV",
    }),
  },
  { after: 700, event: tool(IMPLEMENT_ID, "i1", "Read api/src/routes/invoices.ts", "read", "in_progress") },
  { after: 500, event: tool(IMPLEMENT_ID, "i1", "Read api/src/routes/invoices.ts", "read", "completed") },
  { after: 400, event: tool(IMPLEMENT_ID, "i2", "Write api/src/export/csv.ts", "edit", "in_progress") },
  { after: 900, event: tool(IMPLEMENT_ID, "i2", "Write api/src/export/csv.ts", "edit", "completed") },
  {
    after: 100,
    event: say(IMPLEMENT_ID, {
      additions: 20,
      deletions: 0,
      kind: "file_edit",
      path: "api/src/export/csv.ts",
      tool_call_id: "i2",
    }),
  },
  {
    after: 500,
    event: say(IMPLEMENT_ID, {
      additions: 4,
      deletions: 0,
      kind: "file_edit",
      path: "api/src/routes/invoices.ts",
      tool_call_id: "i3",
    }),
  },
  {
    after: 500,
    event: say(IMPLEMENT_ID, {
      additions: 4,
      deletions: 0,
      kind: "file_edit",
      path: "api/test/export-csv.test.ts",
      tool_call_id: "i4",
    }),
  },
  { after: 300, event: tool(IMPLEMENT_ID, "i5", "bun test api/test", "execute", "in_progress") },
  { after: 1200, event: tool(IMPLEMENT_ID, "i5", "bun test api/test", "execute", "completed") },
  {
    after: 300,
    event: say(IMPLEMENT_ID, {
      kind: "agent_text",
      text: "`GET /invoices?format=csv` now streams an RFC 4180 CSV of the tenant's invoices for the range. Quoting is covered by a test; the suite passes.",
    }),
  },
  { after: 200, event: say(IMPLEMENT_ID, { kind: "turn_ended", stop_reason: "end_turn" }) },
  { after: 100, event: { data: { ...implementTask, status: "done" }, event: "task.updated" } },
  {
    after: 100,
    event: card("agent_output", "Implement completed", "success", {
      agents: [IMPLEMENTER],
      detail: "`GET /invoices?format=csv` returns an RFC 4180 CSV. Tests pass.",
      stage: "implement",
    }),
  },

  // Review, round one: changes requested.
  { after: 600, event: parent({ round: 1, stage: "review" }, 1) },
  { after: 100, event: { data: reviewTask, event: "task.created" } },
  {
    after: 100,
    event: card("stage_started", "Review round 1/3 started", "running", {
      agents: [REVIEWER],
      detail: "1 reviewer(s) running.",
      stage: "review",
    }),
  },
  {
    after: 300,
    event: say(REVIEW_ID, {
      kind: "user_message",
      text: "You are a code reviewer in workflow round 1/3. Review the implementation against the task. Do not edit files.",
    }),
  },
  { after: 600, event: tool(REVIEW_ID, "r1", "Read api/src/routes/invoices.ts", "read", "in_progress") },
  { after: 700, event: tool(REVIEW_ID, "r1", "Read api/src/routes/invoices.ts", "read", "completed") },
  {
    after: 500,
    event: say(REVIEW_ID, {
      kind: "agent_text",
      text: "**Changes requested.** The CSV branch returns before `range(req)` is validated, so an inverted range exports every invoice. The JSON path rejects it with `400`.",
    }),
  },
  { after: 200, event: say(REVIEW_ID, { kind: "turn_ended", stop_reason: "end_turn" }) },
  { after: 100, event: { data: { ...reviewTask, status: "done" }, event: "task.updated" } },
  {
    after: 100,
    event: card("review_result", "reviewer (codex): changes requested", "warning", {
      agents: [REVIEWER],
      stage: "review",
    }),
  },
  {
    after: 100,
    event: card("status", "Review round 1: changes requested — 1 medium.", "warning", {
      detail: FINDING,
    }),
  },

  // Fix, then a second round in the same reviewer session.
  { after: 600, event: parent({ round: 1, stage: "fix", verdict: "request_changes" }, 2) },
  { after: 100, event: { data: fixTask, event: "task.created" } },
  {
    after: 100,
    event: card("stage_started", "Fix started", "running", { agents: [FIXER], stage: "fix" }),
  },
  {
    after: 300,
    event: say(FIX_ID, {
      kind: "user_message",
      text: `You are the repair stage of a workflow pipeline (round 1/3). Reviewers found problems; fix them.\n\n${FINDING}`,
    }),
  },
  { after: 600, event: tool(FIX_ID, "f1", "Edit api/src/routes/invoices.ts", "edit", "in_progress") },
  { after: 800, event: tool(FIX_ID, "f1", "Edit api/src/routes/invoices.ts", "edit", "completed") },
  {
    after: 100,
    event: say(FIX_ID, {
      additions: 1,
      deletions: 1,
      kind: "file_edit",
      path: "api/src/routes/invoices.ts",
      tool_call_id: "f1",
    }),
  },
  {
    after: 300,
    event: say(FIX_ID, {
      kind: "agent_text",
      text: "Both formats now go through the same validated range; an inverted one is a `400` for CSV too.",
    }),
  },
  { after: 200, event: say(FIX_ID, { kind: "turn_ended", stop_reason: "end_turn" }) },
  { after: 100, event: { data: { ...fixTask, status: "done" }, event: "task.updated" } },
  {
    after: 100,
    event: card("agent_output", "Fix completed", "success", { agents: [FIXER], stage: "fix" }),
  },
  { after: 600, event: parent({ round: 2, stage: "review" }, 3) },
  { after: 100, event: { data: reviewTask, event: "task.updated" } },
  {
    after: 100,
    event: card("stage_started", "Review round 2/3 started", "running", {
      agents: [REVIEWER],
      detail:
        "1 reviewer(s) running; 1 continuing their previous session to verify their own findings.",
      stage: "review",
    }),
  },
  {
    after: 300,
    event: say(REVIEW_ID, {
      kind: "user_message",
      text: "The repair stage has addressed your review. This is review round 2/3.",
    }),
  },
  {
    after: 900,
    event: say(REVIEW_ID, {
      kind: "agent_text",
      text: "**Approved.** The range is validated before either format is produced.",
    }),
  },
  { after: 200, event: say(REVIEW_ID, { kind: "turn_ended", stop_reason: "end_turn" }) },
  { after: 100, event: { data: { ...reviewTask, status: "done" }, event: "task.updated" } },
  {
    after: 100,
    event: card("review_result", "reviewer (codex): approved", "success", {
      agents: [REVIEWER],
      stage: "review",
    }),
  },

  // Finished: the parent yields, Factory opens the draft PR.
  {
    after: 300,
    event: parent({ round: 2, stage: "done", verdict: "approve" }, 4, {
      filesChanged: 3,
      status: "waiting",
    }),
  },
  {
    after: 100,
    event: card(
      "workflow_finished",
      "Workflow Review loop finished after 2 review round(s).",
      "success",
    ),
  },
  { after: 200, event: runner({ resolvedLocation: "worktree", state: "delivering" }) },
  {
    after: 2400,
    event: { data: { pull_request: pullRequest, task_id: FACTORY_TASK_ID }, event: "task.pullRequest" },
  },
  {
    after: 100,
    event: runner({
      prNumber: pullRequest.number,
      prUrl: pullRequest.url,
      resolvedLocation: "worktree",
      state: "delivered",
    }),
  },
];
